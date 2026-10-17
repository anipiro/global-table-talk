import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, PhoneOff, Ban, RotateCcw, Copy, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { listMics, micDeviceId, openMic, pickAudioMime, setMicDeviceId, transcribeChunk } from "@/lib/agent";
import { classifyMicError } from "@/lib/crosstalk";
import { Screen } from "@/components/JoinForm";
import type { Lang } from "@/lib/room";

export const Route = createFileRoute("/test/mic")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mic test — Gamige" },
      { name: "description", content: "Test Gemini transcription of 3-second audio chunks." },
      { property: "og:title", content: "Mic test — Gamige" },
      { property: "og:description", content: "Test Gemini transcription of 3-second audio chunks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MicTestPage,
});

// Pass criteria from gamige-mic-test-protocol.md
const MEDIAN_LAT_MS = 3000; // median chunk latency must be ≤ 3s
const P90_LAT_MS = 6000; // p90 chunk latency must be ≤ 6s
const MIN_SUCCESS = 0.9; // ≥90% of spoken chunks must produce a transcript
const MIN_ACCURACY = 0.9; // ≥90% word accuracy when a reference phrase is provided

type ChunkResult = { n: number; at: string; text: string; language: string | null; ms: number; skipped?: boolean };
type LogEntry = {
  at: string;
  event: "session" | "chunk" | "error" | "denied" | "interrupted" | "recovered" | "stopped";
  detail: string;
  pass?: boolean;
};
type Status = "idle" | "recording" | "interrupted" | "denied" | "error";

type Session = {
  id: number;
  startedAt: string;
  device: string;
  lang: string;
  chunks: ChunkResult[];
  errors: number;
  interruptions: number;
  recoveries: number;
  reference: string;
};

const LOG_KEY = "gamige-mic-test-log-v2";
const SESSIONS_KEY = "gamige-mic-test-sessions";

function deviceInfo() {
  const ua = navigator.userAgent;
  const safari = /^((?!chrome|android).)*safari/i.test(ua);
  const iphone = /iPhone|iPad/.test(ua);
  return `${iphone ? "iPhone/iPad" : "Desktop/other"} · ${safari ? "Safari" : "Chromium/other"} · ${ua.match(/OS [\d_]+|Chrome\/[\d.]+/)?.[0] ?? ""}`;
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
function p90(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]!;
}

/** Word accuracy: fraction of reference words present in the joined transcript (order-insensitive, case-insensitive). */
function wordAccuracy(reference: string, transcript: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:"'«»„“]/g, "").split(/\s+/).filter(Boolean);
  const ref = norm(reference);
  if (!ref.length) return null;
  const got = new Set(norm(transcript));
  const hit = ref.filter((w) => got.has(w)).length;
  return hit / ref.length;
}

function sessionStats(s: Session) {
  const spoken = s.chunks.filter((c) => !c.skipped);
  const ok = spoken.filter((c) => c.text);
  const lat = ok.map((c) => c.ms);
  const med = median(lat);
  const p = p90(lat);
  const success = spoken.length ? ok.length / spoken.length : 0;
  const acc = wordAccuracy(s.reference, ok.map((c) => c.text).join(" "));
  const pass =
    spoken.length > 0 &&
    med <= MEDIAN_LAT_MS &&
    p <= P90_LAT_MS &&
    success >= MIN_SUCCESS &&
    (acc === null || acc >= MIN_ACCURACY) &&
    s.interruptions === s.recoveries;
  return { spoken: spoken.length, ok: ok.length, med, p, success, acc, pass };
}

function MicTestPage() {
  const [lang, setLang] = useState<Lang>("ka");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<ChunkResult[]>([]);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [log, setLog] = useState<LogEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]"); } catch { return []; }
  });
  const [sessions, setSessions] = useState<Session[]>(() => {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]"); } catch { return []; }
  });
  const stopRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nRef = useRef(0);
  const interruptedRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500))); }, [log]);
  useEffect(() => { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(-50))); }, [sessions]);

  function addLog(entry: Omit<LogEntry, "at">) {
    setLog((l) => [...l, { ...entry, at: new Date().toISOString() }]);
  }
  function patchSession(fn: (s: Session) => Session) {
    if (!sessionRef.current) return;
    sessionRef.current = fn(sessionRef.current);
  }

  async function start() {
    setError("");
    setResults([]);
    setLive("");
    nRef.current = 0;
    interruptedRef.current = false;
    const mime = pickAudioMime();
    if (!mime) { setError("This browser can't record audio for transcription."); setStatus("error"); return; }

    let stream: MediaStream;
    try {
      stream = await openMic();
      const track = stream.getAudioTracks()[0];
      addLog({ event: "session", detail: `Mic acquired: ${track?.label || "default"}${micDeviceId() ? " (chosen device)" : ""}`, pass: true });
    } catch (e) {
      const kind = classifyMicError(e);
      const msg = kind === "denied"
        ? "Microphone permission denied. On iPhone: Settings → Safari → Microphone, then reload."
        : kind === "disconnected"
          ? "Microphone not found or busy. Pick another input below and retry."
          : `Mic unavailable: ${(e as Error).message}`;
      setError(msg);
      setStatus(kind === "denied" ? "denied" : "error");
      addLog({ event: kind === "denied" ? "denied" : "error", detail: msg, pass: false });
      listMics().then(setMics).catch(() => {});
      return;
    }
    streamRef.current = stream;
    const device = deviceInfo();
    sessionRef.current = { id: Date.now(), startedAt: new Date().toISOString(), device, lang, chunks: [], errors: 0, interruptions: 0, recoveries: 0, reference };
    addLog({ event: "session", detail: `Started · ${device} · lang=${lang} · mime=${mime}` });

    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        if (stopRef.current && !interruptedRef.current) {
          interruptedRef.current = true;
          patchSession((s) => ({ ...s, interruptions: s.interruptions + 1 }));
          setStatus("interrupted");
          setError("The microphone was taken away (phone call, Siri, or another app). Tap Resume to recover.");
          addLog({ event: "interrupted", detail: "Audio track ended unexpectedly", pass: false });
        }
      };
    });

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    let sampling = true;
    const sample = () => {
      if (!sampling) return;
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
      peak = Math.max(peak * 0.98, rms);
      requestAnimationFrame(sample);
    };
    sample();

    let stopped = false;
    const recordChunk = () => {
      if (stopped) return;
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream, { mimeType: mime });
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        if (stopped || !chunks.length) return;
        const n = ++nRef.current;
        const at = new Date().toISOString();
        const loudness = Math.min(1, peak * 4);
        if (loudness < 0.05) {
          const c: ChunkResult = { n, at, text: "", language: null, ms: 0, skipped: true };
          setResults((rs) => [...rs, c]);
          patchSession((s) => ({ ...s, chunks: [...s.chunks, c] }));
          addLog({ event: "chunk", detail: `Chunk ${n}: silent — skipped` });
          return;
        }
        const blob = new Blob(chunks, { type: mime });
        const t0 = performance.now();
        try {
          const { text, language } = await transcribeChunk(blob, lang);
          const ms = Math.round(performance.now() - t0);
          const c: ChunkResult = { n, at, text: text.trim(), language, ms };
          setResults((rs) => [...rs, c]);
          patchSession((s) => ({ ...s, chunks: [...s.chunks, c] }));
          if (text.trim()) {
            setLive((l) => (l + " " + text.trim()).trim());
            addLog({ event: "chunk", detail: `Chunk ${n}: "${text.trim()}" · ${language ?? "?"} · ${(ms / 1000).toFixed(1)}s`, pass: ms <= P90_LAT_MS });
          } else {
            addLog({ event: "chunk", detail: `Chunk ${n}: empty transcript`, pass: false });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Transcription failed";
          setError(msg);
          patchSession((s) => ({ ...s, errors: s.errors + 1 }));
          addLog({ event: "error", detail: `Chunk ${n}: ${msg}`, pass: false });
        }
      };
      r.start();
      setTimeout(() => { if (r.state !== "inactive") r.stop(); }, 3000);
    };
    recordChunk();
    const interval = setInterval(() => { if (!stopped) recordChunk(); }, 3000);

    stopRef.current = () => {
      stopped = true;
      sampling = false;
      clearInterval(interval);
      stream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      streamRef.current = null;
      void ctx.close().catch(() => {});
    };
    setStatus("recording");
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    if (sessionRef.current && sessionRef.current.chunks.length) {
      const done = sessionRef.current;
      setSessions((ss) => [...ss.filter((s) => s.id !== done.id), done]);
      const st = sessionStats(done);
      addLog({
        event: "stopped",
        detail: `Session ended: ${st.ok}/${st.spoken} chunks, median ${(st.med / 1000).toFixed(1)}s, p90 ${(st.p / 1000).toFixed(1)}s${st.acc !== null ? `, accuracy ${(st.acc * 100).toFixed(0)}%` : ""} → ${st.pass ? "PASS" : "FAIL"}`,
        pass: st.pass,
      });
    } else {
      addLog({ event: "stopped", detail: "Stopped by user" });
    }
    sessionRef.current = null;
    setStatus("idle");
  }

  function simulateInterruption() {
    if (status !== "recording" || !streamRef.current) return;
    interruptedRef.current = true;
    patchSession((s) => ({ ...s, interruptions: s.interruptions + 1 }));
    streamRef.current.getAudioTracks().forEach((t) => { t.onended = null; t.stop(); });
    streamRef.current = null;
    setStatus("interrupted");
    setError("Simulated interruption: the mic was taken away. Tap Resume to check recovery.");
    addLog({ event: "interrupted", detail: "Simulated interruption (test control)", pass: false });
  }

  function simulateDenial() {
    stop();
    setStatus("denied");
    setError("Simulated denial: microphone permission was refused. On a real iPhone this needs Settings → Safari → Microphone.");
    addLog({ event: "denied", detail: "Simulated denial (test control)", pass: false });
  }

  async function resume() {
    const before = nRef.current;
    const prev = sessionRef.current;
    addLog({ event: "session", detail: "Recovery attempt after interruption" });
    await start();
    // keep the same session across the resume
    if (prev && sessionRef.current) {
      sessionRef.current = { ...prev, chunks: prev.chunks };
    }
    setTimeout(() => {
      const ok = nRef.current > before;
      patchSession((s) => ({ ...s, recoveries: s.recoveries + (ok ? 1 : 0) }));
      addLog({ event: "recovered", detail: ok ? "Chunks flowing again after interruption" : "No new chunks within 12s of resume", pass: ok });
      if (!ok) setError("Recovery failed: no new chunks within 12 seconds. Reload the page and try again.");
    }, 12000);
  }

  function download(name: string, content: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportJSON() {
    download(`gamige-mic-sessions-${Date.now()}.json`, JSON.stringify({ thresholds: { medianLatMs: MEDIAN_LAT_MS, p90LatMs: P90_LAT_MS, minSuccess: MIN_SUCCESS, minAccuracy: MIN_ACCURACY }, sessions }, null, 2), "application/json");
  }

  function exportCSV() {
    const rows = [["session_id", "started_at", "device", "lang", "chunk", "chunk_at", "transcript", "detected_lang", "latency_ms", "skipped", "chunk_pass", "session_pass"]];
    for (const s of sessions) {
      const st = sessionStats(s);
      for (const c of s.chunks) {
        rows.push([String(s.id), s.startedAt, s.device, s.lang, String(c.n), c.at, `"${c.text.replace(/"/g, '""')}"`, c.language ?? "", String(c.ms), String(!!c.skipped), String(!c.skipped && !!c.text && c.ms <= P90_LAT_MS), String(st.pass)]);
      }
    }
    download(`gamige-mic-sessions-${Date.now()}.csv`, rows.map((r) => r.join(",")).join("\n"), "text/csv");
  }

  async function copyLog() {
    const text = log.map((e) => `${e.at}  ${e.event.toUpperCase()}${e.pass === undefined ? "" : e.pass ? " PASS" : " FAIL"}  ${e.detail}`).join("\n");
    await navigator.clipboard.writeText(text);
    toast.success("Test log copied");
  }

  const comparison = useMemo(() => sessions.map((s, i) => {
    const st = sessionStats(s);
    const prev = i > 0 ? sessionStats(sessions[i - 1]!) : null;
    return { s, st, prev };
  }), [sessions]);

  const STATUS_LABEL: Record<Status, string> = {
    idle: "Ready", recording: "Recording…", interrupted: "Interrupted", denied: "Mic denied", error: "Error",
  };

  return (
    <Screen>
      <h1 className="text-3xl font-bold">Mic test</h1>
      <p className="mt-2 text-muted-foreground">
        Records 3-second chunks, sends them to Gemini Transcribe, and times each one. Pass criteria: ≥90% word accuracy, median ≤3s, p90 ≤6s chunk latency.
      </p>

      <div className={`mt-4 rounded-2xl p-3 text-center font-semibold ${
        status === "recording" ? "bg-primary/20 text-primary"
        : status === "idle" ? "bg-secondary text-muted-foreground"
        : "bg-destructive/20 text-destructive-foreground"}`}>
        {STATUS_LABEL[status]}
      </div>

      <div className="mt-4 flex gap-2">
        {(["ka", "en", "ru"] as Lang[]).map((l) => (
          <button key={l} onClick={() => setLang(l)} disabled={status === "recording"}
            className={`flex-1 rounded-full py-3 font-semibold ${lang === l ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
            {l === "ka" ? "Georgian" : l === "en" ? "English" : "Russian"}
          </button>
        ))}
      </div>

      <input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        disabled={status === "recording"}
        placeholder="Reference phrase (optional, for word accuracy)"
        className="mt-3 w-full rounded-2xl bg-secondary px-4 py-3 text-base outline-none placeholder:text-muted-foreground"
      />

      <button
        onClick={status === "recording" ? stop : status === "interrupted" ? resume : start}
        className={`mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-full text-lg font-bold ${
          status === "recording" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
      >
        {status === "recording" ? <><Square /> Stop</> : status === "interrupted" ? <><RotateCcw /> Resume</> : <><Mic /> Record</>}
      </button>

      <div className="mt-4 flex gap-2">
        <button onClick={simulateInterruption} disabled={status !== "recording"}
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-destructive/50 py-3 text-sm font-semibold text-destructive-foreground disabled:opacity-40">
          <PhoneOff className="h-4 w-4" /> Simulate call
        </button>
        <button onClick={simulateDenial}
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-destructive/50 py-3 text-sm font-semibold text-destructive-foreground">
          <Ban className="h-4 w-4" /> Simulate denial
        </button>
      </div>

      {error && <p className="mt-4 rounded-2xl bg-destructive/20 p-3 text-destructive-foreground">{error}</p>}

      {live && (
        <div className="mt-6 rounded-3xl bg-card p-4">
          <p className="mb-1 text-sm font-semibold text-primary">Transcript</p>
          <p className="text-xl leading-snug">{live}</p>
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2 text-base">
          {results.map((r) => (
            <li key={r.n} className="flex items-baseline justify-between gap-3 rounded-2xl bg-secondary p-3">
              <span className={r.skipped ? "italic text-muted-foreground" : ""}>
                {r.skipped ? `Chunk ${r.n}: silent — skipped` : r.text}
              </span>
              {!r.skipped && (
                <span className={`shrink-0 text-sm ${r.ms > P90_LAT_MS ? "font-bold text-destructive-foreground" : "text-muted-foreground"}`}>
                  {r.language ?? "?"} · {(r.ms / 1000).toFixed(1)}s
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* session comparison */}
      {comparison.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Sessions</h2>
            <div className="flex gap-2">
              <button onClick={exportCSV} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2 text-sm"><Download className="h-4 w-4" /> CSV</button>
              <button onClick={exportJSON} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2 text-sm"><Download className="h-4 w-4" /> JSON</button>
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-3">
            {comparison.map(({ s, st, prev }) => {
              const dMed = prev ? st.med - prev.med : 0;
              const dSucc = prev ? st.success - prev.success : 0;
              const dAcc = prev && st.acc !== null && prev.acc !== null ? st.acc - prev.acc : 0;
              const delta = (d: number, unit: string, goodWhenNegative: boolean) => {
                if (!prev || d === 0) return null;
                const good = goodWhenNegative ? d < 0 : d > 0;
                return <span className={`ml-1 text-xs font-bold ${good ? "text-primary" : "text-destructive-foreground"}`}>{d > 0 ? "+" : ""}{unit === "%" ? (d * 100).toFixed(0) + unit : (d / 1000).toFixed(1) + unit}</span>;
              };
              return (
                <div key={s.id} className={`rounded-2xl border p-4 text-sm ${st.pass ? "border-primary/40" : "border-destructive/40"}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{new Date(s.startedAt).toLocaleString()} · {s.lang}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.pass ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive-foreground"}`}>
                      {st.pass ? "PASS" : "FAIL"}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{s.device}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    <p>Chunks: {st.ok}/{st.spoken}{delta(dSucc, "%", false)}</p>
                    <p>Median: {(st.med / 1000).toFixed(1)}s{delta(dMed, "s", true)}</p>
                    <p>p90: {(st.p / 1000).toFixed(1)}s</p>
                    <p>Accuracy: {st.acc === null ? "—" : `${(st.acc * 100).toFixed(0)}%`}{delta(dAcc, "%", false)}</p>
                    <p>Interruptions: {s.interruptions}</p>
                    <p>Recovered: {s.recoveries}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* raw run log */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Run log</h2>
          <div className="flex gap-2">
            <button onClick={copyLog} aria-label="Copy log" className="rounded-full bg-secondary p-2"><Copy className="h-4 w-4" /></button>
            <button onClick={() => { setLog([]); setSessions([]); localStorage.removeItem(LOG_KEY); localStorage.removeItem(SESSIONS_KEY); }} aria-label="Clear log" className="rounded-full bg-secondary p-2"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
        {log.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Sessions, chunks and recovery checks are logged here with device and browser.</p>
        ) : (
          <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
            {[...log].reverse().map((e, i) => (
              <li key={i} className="flex gap-2 rounded-xl bg-secondary/60 px-3 py-2">
                <span className="shrink-0 text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
                <span className={`shrink-0 font-semibold ${e.pass === false ? "text-destructive-foreground" : e.pass ? "text-primary" : "text-muted-foreground"}`}>
                  {e.event}{e.pass === undefined ? "" : e.pass ? " ✓" : " ✗"}
                </span>
                <span className="break-all">{e.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}
