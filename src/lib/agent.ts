import { supabase } from "@/integrations/supabase/client";
import type { Lang, Member } from "./room";
import { keepByConfidence, keepByLanguage, passesVoiceGate, VOICE_GATE } from "./crosstalk";

/** Calls the agent server endpoint; throws with a readable message on failure. */
async function call(body: Record<string, string>) {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Agent unavailable" }));
    throw new Error(err.error ?? "Agent unavailable");
  }
  return res;
}

const SPEECH_LANG: Record<Lang, string> = { ka: "ka-GE", en: "en-US", ru: "ru-RU" };

/** Speech engine per member: Georgian uses the Gemini chunk recorder; en/ru use the browser's Web Speech API.
 *  Hidden setting: localStorage "gamige-force-gemini" = "1" forces Gemini for everyone (for comparison testing). */
export function speechEngine(lang: Lang): "gemini" | "webspeech" {
  if (typeof localStorage !== "undefined" && localStorage.getItem("gamige-force-gemini") === "1") return "gemini";
  return lang === "ka" ? "gemini" : "webspeech";
}

/** Picks the best audio mimeType this browser's MediaRecorder supports (Safari records audio/mp4). */
export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

/** Sends one audio chunk to the server transcriber; returns text + detected language. */
export async function transcribeChunk(blob: Blob, languageHint: Lang): Promise<{ text: string; language: string | null }> {
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([blob], `chunk.${ext}`, { type: blob.type || "audio/webm" }));
  form.append("language", languageHint);
  const res = await fetch("/api/agent", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Transcription failed" }));
    throw new Error(err.error ?? "Transcription failed");
  }
  return res.json();
}

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> }) => void;
  onend: () => void; onerror: (e: { error: string }) => void; start: () => void; stop: () => void;
};
let rec: Rec | null = null;
let micStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let wanted = false;
let chunkTimer: ReturnType<typeof setInterval> | null = null;
let recorder: MediaRecorder | null = null;
let lastPeak = 0;
let droppedCount = 0;
let debugCb: ((d: { rms: number; threshold: number; dropped: number }) => void) | null = null;

/** Debug overlay feed: live RMS, active voice threshold, and dropped-line count. */
export function setMicDebug(cb: typeof debugCb) {
  debugCb = cb;
  if (cb) cb({ rms: 0, threshold: 0, dropped: droppedCount });
}
export const getDroppedCount = () => droppedCount;

function noteDrop(threshold: number) {
  droppedCount++;
  debugCb?.({ rms: lastPeak, threshold, dropped: droppedCount });
}

/** Records ~2.5s of speech and returns the member's average speaking RMS (voice calibration). */
export async function calibrateVoice(): Promise<number> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const samples: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
        samples.push(rms);
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    await ctx.close().catch(() => {});
    // average the louder half of frames — the moments they were actually speaking
    const sorted = [...samples].sort((a, b) => b - a);
    const speaking = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
    return speaking.reduce((s, v) => s + v, 0) / speaking.length;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** Short device label stored with voice calibration; a change flags recalibration. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const iphone = /iPhone|iPad/.test(ua);
  const safari = /^((?!chrome|android).)*safari/i.test(ua);
  return `${iphone ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : "Desktop"} · ${safari ? "Safari" : "Chromium"}`;
}

/** Inserts a line through the atomic server-side arbitration (loudest phone wins).
 *  Returns the new line id, or null when another phone's line won and ours was dropped. */
async function insertLine(member: Member, text: string, loudness: number): Promise<string | null> {
  const { data, error } = await supabase.rpc("insert_line", {
    p_room_id: member.room_id,
    p_speaker_id: member.id,
    p_text: text,
    p_language: member.language,
    p_loudness: loudness,
  });
  if (error) throw error;
  return data;
}

export const micSupported = (lang?: Lang) =>
  typeof window !== "undefined" &&
  (lang && speechEngine(lang) === "gemini"
    ? typeof MediaRecorder !== "undefined" && !!pickAudioMime()
    : !!((window as never)["SpeechRecognition"] || (window as never)["webkitSpeechRecognition"]));

/** Listens on this phone's mic, writes each finished sentence as a line, and asks the agents to translate it. */
export async function startMic(
  member: Member,
  onInterim: (text: string) => void,
  onError: (msg: string) => void,
) {
  const engine = speechEngine(member.language as Lang);
  if (engine === "webspeech") {
    const SR = (window as never)["SpeechRecognition"] || (window as never)["webkitSpeechRecognition"];
    if (!SR) throw new Error("Live captions need Chrome, Edge or Safari on this phone.");
  } else if (typeof MediaRecorder === "undefined" || !pickAudioMime()) {
    throw new Error("This browser can't record audio for transcription.");
  }
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(micStream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const threshold = member.voice_level ? VOICE_GATE * member.voice_level : 0;
  let peak = 0;
  const sample = () => {
    if (!audioCtx) return;
    analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    peak = Math.max(peak * 0.98, rms);
    lastPeak = peak;
    debugCb?.({ rms: peak, threshold, dropped: droppedCount });
    requestAnimationFrame(sample);
  };
  sample();

  if (engine === "gemini") {
    startGeminiMic(member, micStream, () => peak, onError);
    return;
  }

  wanted = true;
  const SR = (window as never)["SpeechRecognition"] || (window as never)["webkitSpeechRecognition"];
  rec = new (SR as new () => Rec)();
  rec.lang = SPEECH_LANG[member.language as Lang] ?? "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = async (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      const text = r[0].transcript.trim();
      if (!r.isFinal) { interim += text + " "; continue; }
      if (!text) continue;
      const loudness = Math.min(1, peak * 4);
      if (!keepByConfidence(r[0].confidence ?? 0) || !passesVoiceGate(peak, member.voice_level)) {
        peak = 0;
        noteDrop(threshold);
        continue;
      }
      peak = 0;
      try {
        const lineId = await insertLine(member, text, loudness);
        if (!lineId) { noteDrop(threshold); continue; } // another phone's line won the arbitration
        call({ task: "translate", lineId }).catch((err) => onError(err.message));
      } catch {
        onError("Couldn't save what you said.");
      }
    }
    onInterim(interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") { wanted = false; onError("Microphone permission was denied."); }
  };
  rec.onend = () => { if (wanted) rec?.start(); };
  rec.start();
}

/** Records 3-second chunks (fresh recorder each time, so every chunk is a complete file),
 *  skips silent ones via the RMS analyser, transcribes with Gemini and posts each line. */
function startGeminiMic(member: Member, stream: MediaStream, getPeak: () => number, onError: (msg: string) => void) {
  wanted = true;
  const mime = pickAudioMime();
  const SILENCE = 0.012;

  const recordChunk = () => {
    if (!wanted) return;
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder = r;
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      recorder = null;
      const loudness = Math.min(1, getPeak() * 4);
      if (!wanted || !chunks.length) return;
      if (loudness < SILENCE * 4) return; // silent chunk — skip the upload
      const chunkThreshold = member.voice_level ? VOICE_GATE * member.voice_level : 0;
      if (!passesVoiceGate(getPeak(), member.voice_level)) { noteDrop(chunkThreshold); return; } // too quiet vs my calibrated voice — crosstalk
      const blob = new Blob(chunks, { type: mime || "audio/webm" });
      try {
        const { text, language } = await transcribeChunk(blob, member.language as Lang);
        const clean = text.trim();
        if (!clean) return;
        if (!keepByLanguage(language, member.language)) { noteDrop(chunkThreshold); return; } // detected a different language — the neighbour's voice
        try {
          const lineId = await insertLine(member, clean, loudness);
          if (!lineId) { noteDrop(chunkThreshold); return; } // another phone's line won the arbitration
          call({ task: "translate", lineId }).catch((err) => onError(err.message));
        } catch {
          onError("Couldn't save what you said.");
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Transcription failed");
      }
    };
    r.start();
    setTimeout(() => { if (r.state !== "inactive") r.stop(); }, 3000);
  };

  recordChunk();
  const loop = () => {
    if (!wanted) return;
    chunkTimer = setTimeout(loop, 3000);
    recordChunk();
  };
  chunkTimer = setTimeout(loop, 3000);
}

export async function stopMic() {
  wanted = false;
  if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
  rec?.stop();
  rec = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  await audioCtx?.close().catch(() => {});
  audioCtx = null;
}

/** Streams a personal catch-up from my agent; the finished text is also saved as a private card. */
export async function requestCatchUp(memberId: string, onChunk: (textSoFar: string) => void) {
  const res = await call({ task: "catchup", memberId });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    onChunk(text);
  }
  return text;
}

export async function describePhoto(photoId: string) {
  await call({ task: "describe", photoId });
}

export async function generateRecap(roomId: string) {
  await call({ task: "recap", roomId });
}

/** Speaks a translated line quietly through the headphones. */
export async function playWhisper(text: string, language: string) {
  if (typeof speechSynthesis === "undefined") return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[language as Lang] ?? "en-US";
  u.rate = 1.05;
  u.volume = 0.8;
  speechSynthesis.speak(u);
}
