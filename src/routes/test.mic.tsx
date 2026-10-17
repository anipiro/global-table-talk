import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, PhoneOff, Ban, RotateCcw, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { pickAudioMime, transcribeChunk } from "@/lib/agent";
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

type ChunkResult = { n: number; text: string; language: string | null; ms: number; skipped?: boolean };
type LogEntry = {
  at: string; // ISO timestamp
  event: "session" | "chunk" | "error" | "denied" | "interrupted" | "recovered" | "stopped";
  detail: string;
  pass?: boolean;
};
type Status = "idle" | "recording" | "interrupted" | "denied" | "error";

const LOG_KEY = "gamige-mic-test-log";

function deviceInfo() {
  const ua = navigator.userAgent;
  const safari = /^((?!chrome|android).)*safari/i.test(ua);
  const iphone = /iPhone|iPad/.test(ua);
  return `${iphone ? "iPhone/iPad" : "Desktop/other"} · ${safari ? "Safari" : "Chromium/other"} · ${ua.match(/OS [\d_]+|Chrome\/[\d.]+/)?.[0] ?? ""}`;
}

function MicTestPage() {
  const [lang, setLang] = useState<Lang>("ka");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<ChunkResult[]>([]);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<LogEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]"); } catch { return []; }
  });
  const stopRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nRef = useRef(0);
  const interruptedRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500)));
  }, [log]);

  function addLog(entry: Omit<LogEntry, "at">) {
    setLog((l) => [...l, { ...entry, at: new Date().toISOString() }]);
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException).name;
      const msg = name === "NotAllowedError"
        ? "Microphone permission denied. On iPhone: Settings → Safari → Microphone, then reload."
        : `Mic unavailable: ${(e as Error).message}`;
      setError(msg);
      setStatus("denied");
      addLog({ event: "denied", detail: msg, pass: false });
      return;
    }
    streamRef.current = stream;
    addLog({ event: "session", detail: `Started · ${deviceInfo()} · lang=${lang} · mime=${mime}` });

    // Real interruption detection (phone call, Siri, another app grabbing the mic)
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        if (stopRef.current && !interruptedRef.current) {
          interruptedRef.current = true;
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
        const loudness = Math.min(1, peak * 4);
        if (loudness < 0.05) {
          setResults((rs) => [...rs, { n, text: "", language: null, ms: 0, skipped: true }]);
          addLog({ event: "chunk", detail: `Chunk ${n}: silent — skipped` });
          return;
        }
        const blob = new Blob(chunks, { type: mime });
        const t0 = performance.now();
        try {
          const { text, language } = await transcribeChunk(blob, lang);
          const ms = Math.round(performance.now() - t0);
          if (text.trim()) {
            setResults((rs) => [...rs, { n, text: text.trim(), language, ms }]);
            setLive((l) => (l + " " + text.trim()).trim());
            addLog({ event: "chunk", detail: `Chunk ${n}: "${text.trim()}" · ${language ?? "?"} · ${(ms / 1000).toFixed(1)}s`, pass: true });
          } else {
            addLog({ event: "chunk", detail: `Chunk ${n}: empty transcript`, pass: false });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Transcription failed";
          setError(msg);
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
    setStatus("idle");
    addLog({ event: "stopped", detail: "Stopped by user" });
  }

  /** Simulates a phone-call interruption: kills the mic tracks mid-recording. */
  function simulateInterruption() {
    if (status !== "recording" || !streamRef.current) return;
    interruptedRef.current = true;
    streamRef.current.getAudioTracks().forEach((t) => { t.onended = null; t.stop(); });
    streamRef.current = null;
    setStatus("interrupted");
    setError("Simulated interruption: the mic was taken away. Tap Resume to check recovery.");
    addLog({ event: "interrupted", detail: "Simulated interruption (test control)", pass: false });
  }

  /** Simulates a fresh permission denial state (does not change real browser permission). */
  function simulateDenial() {
    stop();
    setStatus("denied");
    setError("Simulated denial: microphone permission was refused. On a real iPhone this needs Settings → Safari → Microphone.");
    addLog({ event: "denied", detail: "Simulated denial (test control)", pass: false });
  }

  /** Recovery check: restart recording after an interruption; passes if a new chunk lands. */
  async function resume() {
    const before = nRef.current;
    addLog({ event: "session", detail: "Recovery attempt after interruption" });
    await start();
    // recovery is confirmed by the next chunk log entries; mark after 12s
    setTimeout(() => {
      setNRefCheck(before);
    }, 12000);
  }
  function setNRefCheck(before: number) {
    const ok = nRef.current > before;
    addLog({ event: "recovered", detail: ok ? "Chunks flowing again after interruption" : "No new chunks within 12s of resume", pass: ok });
    if (!ok) setError("Recovery failed: no new chunks within 12 seconds. Reload the page and try again.");
  }

  async function copyLog() {
    const text = log.map((e) => `${e.at}  ${e.event.toUpperCase()}${e.pass === undefined ? "" : e.pass ? " PASS" : " FAIL"}  ${e.detail}`).join("\n");
    await navigator.clipboard.writeText(text);
    toast.success("Test log copied");
  }

  const STATUS_LABEL: Record<Status, string> = {
    idle: "Ready", recording: "Recording…", interrupted: "Interrupted", denied: "Mic denied", error: "Error",
  };

  return (
    <Screen>
      <h1 className="text-3xl font-bold">Mic test</h1>
      <p className="mt-2 text-muted-foreground">
        Records 3-second chunks, sends them to Gemini Transcribe, and times each one. Silent chunks are skipped.
      </p>

      {/* status banner */}
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

      <button
        onClick={status === "recording" ? stop : status === "interrupted" ? resume : start}
        className={`mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-full text-lg font-bold ${
          status === "recording" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
      >
        {status === "recording" ? <><Square /> Stop</> : status === "interrupted" ? <><RotateCcw /> Resume</> : <><Mic /> Record</>}
      </button>

      {/* failure-simulation controls */}
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
                <span className="shrink-0 text-sm text-muted-foreground">
                  {r.language ?? "?"} · {(r.ms / 1000).toFixed(1)}s
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* test run log */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Run log</h2>
          <div className="flex gap-2">
            <button onClick={copyLog} aria-label="Copy log" className="rounded-full bg-secondary p-2"><Copy className="h-4 w-4" /></button>
            <button onClick={() => { setLog([]); localStorage.removeItem(LOG_KEY); }} aria-label="Clear log" className="rounded-full bg-secondary p-2"><Trash2 className="h-4 w-4" /></button>
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
