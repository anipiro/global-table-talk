import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
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

function MicTestPage() {
  const [lang, setLang] = useState<Lang>("ka");
  const [recording, setRecording] = useState(false);
  const [results, setResults] = useState<ChunkResult[]>([]);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const nRef = useRef(0);

  async function start() {
    setError("");
    setResults([]);
    setLive("");
    nRef.current = 0;
    const mime = pickAudioMime();
    if (!mime) { setError("This browser can't record audio for transcription."); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // RMS analyser for silence skipping
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
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Transcription failed");
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
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    };
    setRecording(true);
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    setRecording(false);
  }

  return (
    <Screen>
      <h1 className="text-3xl font-bold">Mic test</h1>
      <p className="mt-2 text-muted-foreground">
        Records 3-second chunks, sends them to Gemini Transcribe, and times each one. Silent chunks are skipped.
      </p>

      <div className="mt-6 flex gap-2">
        {(["ka", "en", "ru"] as Lang[]).map((l) => (
          <button key={l} onClick={() => setLang(l)} disabled={recording}
            className={`flex-1 rounded-full py-3 font-semibold ${lang === l ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
            {l === "ka" ? "Georgian" : l === "en" ? "English" : "Russian"}
          </button>
        ))}
      </div>

      <button
        onClick={recording ? stop : start}
        className={`mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-full text-lg font-bold ${recording ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
      >
        {recording ? <><Square /> Stop</> : <><Mic /> Record</>}
      </button>

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
    </Screen>
  );
}
