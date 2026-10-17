import { supabase } from "@/integrations/supabase/client";
import type { Lang, Member } from "./room";
import { cleanTranscript, isLoudestFrame, keepByConfidence, keepByLanguage, ownsChunk, passesVoiceGate, speakingLevel, VOICE_GATE } from "./crosstalk";

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
const onErrorRef: { current: ((msg: string) => void) | null } = { current: null };

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
  const stream = await openMic();
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
    return speakingLevel(samples);
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

/** Chosen microphone (localStorage "gamige-mic-device"); null = system default. */
export const micDeviceId = () => (typeof localStorage === "undefined" ? null : localStorage.getItem("gamige-mic-device"));
export const setMicDeviceId = (id: string | null) =>
  id ? localStorage.setItem("gamige-mic-device", id) : localStorage.removeItem("gamige-mic-device");

/** Lists available microphones (labels need mic permission first). */
export async function listMics(): Promise<{ deviceId: string; label: string }[]> {
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter((d) => d.kind === "audioinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

// Auto gain off: with it on, iPhones boost a neighbour's voice to the same level as their owner's,
// which makes "which phone heard it loudest" meaningless.
const VOICE_PROCESSING = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
const audioConstraints = () => {
  const id = micDeviceId();
  return { audio: id ? { deviceId: { exact: id }, ...VOICE_PROCESSING } : VOICE_PROCESSING };
};

/** Opens the mic, falling back to the default device when the remembered one is gone. */
export async function openMic(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(audioConstraints());
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (micDeviceId() && (name === "OverconstrainedError" || name === "NotFoundError")) {
      setMicDeviceId(null); // remembered mic no longer exists — forget it and use the default
      return navigator.mediaDevices.getUserMedia({ audio: VOICE_PROCESSING });
    }
    throw e;
  }
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

type Frame = { rms: number; speech: boolean; loudest: boolean };
let voiceChannel: ReturnType<typeof supabase.channel> | null = null;
let shareTimer: ReturnType<typeof setInterval> | null = null;

/** Shares this phone's live mic level with the other phones at the table and tracks theirs,
 *  so each phone knows, moment by moment, whether it is the one closest to whoever is talking. */
function joinVoiceLevels(member: Member) {
  const others = new Map<string, { level: number; at: number }[]>();
  voiceChannel = supabase.channel(`voice-${member.room_id}`, { config: { broadcast: { self: false } } });
  voiceChannel
    .on("broadcast", { event: "level" }, ({ payload }) => {
      const p = payload as { id: string; level: number };
      if (!p?.id || p.id === member.id) return;
      const list = (others.get(p.id) ?? []).filter((x) => performance.now() - x.at < 600);
      list.push({ level: p.level, at: performance.now() });
      others.set(p.id, list);
    })
    .subscribe();
  let windowMax = 0;
  shareTimer = setInterval(() => {
    voiceChannel?.send({ type: "broadcast", event: "level", payload: { id: member.id, level: windowMax } });
    windowMax = 0;
  }, 150);
  return {
    note: (rms: number) => { windowMax = Math.max(windowMax, rms); },
    /** Loudest level each other phone reported in the last ~450ms (covers network delay). */
    othersNow: () => {
      const now = performance.now();
      return [...others.values()].map((l) => Math.max(0, ...l.filter((x) => now - x.at < 450).map((x) => x.level)));
    },
  };
}

/** Listens on this phone's mic, writes each finished sentence as a line, and asks the agents to translate it. */
export async function startMic(
  member: Member,
  onInterim: (text: string) => void,
  onError: (msg: string) => void,
) {
  onErrorRef.current = onError;
  const engine = speechEngine(member.language as Lang);
  if (engine === "webspeech") {
    const SR = (window as never)["SpeechRecognition"] || (window as never)["webkitSpeechRecognition"];
    if (!SR) throw new Error("Live captions need Chrome, Edge or Safari on this phone.");
  } else if (typeof MediaRecorder === "undefined" || !pickAudioMime()) {
    throw new Error("This browser can't record audio for transcription.");
  }
  micStream = await openMic();
  // Mid-session mic loss (unplugged, taken by another app): report and surface a recovery state.
  micStream.getAudioTracks().forEach((t) => {
    t.onended = () => { if (wanted) { void stopMic(); onErrorRef.current?.("__disconnected__"); } };
  });
  audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(micStream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const threshold = member.voice_level ? VOICE_GATE * member.voice_level : 0;
  // A frame counts as speech above this level (never below a fixed silence floor).
  const speechLevel = Math.max(0.01, threshold * 0.8);
  const levels = joinVoiceLevels(member);
  let recent: number[] = []; // my last ~150ms of frames, compared with the other phones' 150ms maxima
  let frames: Frame[] = [];
  const takeFrames = () => { const f = frames; frames = []; return f; };
  let onFrame: ((f: Frame) => void) | null = null;
  const sample = () => {
    if (!audioCtx) return;
    analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    levels.note(rms);
    recent.push(rms);
    if (recent.length > 9) recent = recent.slice(-9);
    const f: Frame = { rms, speech: rms >= speechLevel, loudest: isLoudestFrame(Math.max(...recent), levels.othersNow()) };
    frames.push(f);
    if (frames.length > 1200) frames.shift();
    onFrame?.(f);
    lastPeak = rms;
    debugCb?.({ rms, threshold, dropped: droppedCount });
    requestAnimationFrame(sample);
  };
  sample();

  if (engine === "gemini") {
    onFrame = startGeminiMic(member, micStream, takeFrames, speechLevel, threshold, onError);
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
      const f = takeFrames();
      const loudness = speakingLevel(f.filter((x) => x.speech).map((x) => x.rms));
      if (!keepByConfidence(r[0].confidence ?? 0) || !passesVoiceGate(loudness, member.voice_level) || !ownsChunk(f)) {
        noteDrop(threshold);
        continue;
      }
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

/** Gemini recorder, cut by voice activity: a chunk ends ~0.6s after the speaker pauses (or at 8s),
 *  so short phrases go out right away instead of waiting for a fixed 3s boundary, and words aren't split.
 *  A phone only uploads chunks it "owns" — it was the loudest phone for enough of the speech. */
const PAUSE_MS = 600;
const MAX_CHUNK_MS = 8000;
const IDLE_RECYCLE_MS = 4000;
function startGeminiMic(
  member: Member, stream: MediaStream, takeFrames: () => Frame[], speechLevel: number, threshold: number,
  onError: (msg: string) => void,
): (f: Frame) => void {
  wanted = true;
  const mime = pickAudioMime();
  let cur: { r: MediaRecorder; chunks: Blob[]; startedAt: number; spoke: boolean; lastSpeech: number } | null = null;

  const begin = () => {
    if (!wanted) return;
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const c = { r, chunks: [] as Blob[], startedAt: performance.now(), spoke: false, lastSpeech: 0 };
    r.ondataavailable = (e) => { if (e.data.size) c.chunks.push(e.data); };
    r.start();
    recorder = r;
    cur = c;
    takeFrames(); // this chunk's frames start now
  };

  const finish = (c: NonNullable<typeof cur>, frames: Frame[]) => {
    c.r.onstop = async () => {
      if (!wanted || !c.chunks.length) return;
      const loudness = speakingLevel(frames.filter((x) => x.speech).map((x) => x.rms));
      if (!ownsChunk(frames)) { noteDrop(threshold); return; } // another phone was closer — not my owner talking
      if (!passesVoiceGate(loudness, member.voice_level)) { noteDrop(threshold); return; }
      const blob = new Blob(c.chunks, { type: mime || "audio/webm" });
      try {
        const { text, language } = await transcribeChunk(blob, member.language as Lang);
        const clean = cleanTranscript(text, member.language);
        if (!clean) return;
        if (!keepByLanguage(language, member.language)) { noteDrop(threshold); return; }
        try {
          const lineId = await insertLine(member, clean, loudness);
          if (!lineId) { noteDrop(threshold); return; } // another phone's line won the arbitration
          call({ task: "translate", lineId }).catch((err) => onError(err.message));
        } catch {
          onError("Couldn't save what you said.");
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Transcription failed");
      }
    };
    if (c.r.state !== "inactive") c.r.stop();
  };

  const discard = (c: NonNullable<typeof cur>) => {
    c.r.ondataavailable = null;
    if (c.r.state !== "inactive") c.r.stop();
  };

  begin();
  return (f: Frame) => {
    const c = cur;
    if (!wanted || !c) return;
    const now = performance.now();
    if (f.speech) { c.spoke = true; c.lastSpeech = now; }
    if (!c.spoke && now - c.startedAt > IDLE_RECYCLE_MS) {
      begin(); // new recorder first, so nothing said in between is lost
      discard(c);
    } else if (c.spoke && (now - c.lastSpeech > PAUSE_MS || now - c.startedAt > MAX_CHUNK_MS)) {
      const frames = takeFrames();
      begin();
      finish(c, frames);
    }
  };
}

export async function stopMic() {
  wanted = false;
  if (shareTimer) { clearInterval(shareTimer); shareTimer = null; }
  if (voiceChannel) { void supabase.removeChannel(voiceChannel); voiceChannel = null; }
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
