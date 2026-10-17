import { supabase } from "@/integrations/supabase/client";
import type { Lang, Member } from "./room";
import { attribute, cleanTranscript, isLoudestFrame, keepByConfidence, keepByLanguage, learnFromCorrection, ownVoiceRef, speakingLevel, type VoiceLearning } from "./crosstalk";

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

/** This phone's recent keep/drop decisions, for the diagnostics tab. */
export type Decision = {
  at: number; text: string; level: number; ref: number | null; share: number; confidence: number;
  outcome: "kept" | "unknown" | "dropped"; reason: string; delayMs: number | null;
};
const decisions: Decision[] = [];
let decisionCb: ((d: Decision[]) => void) | null = null;
export function watchDecisions(cb: typeof decisionCb) {
  decisionCb = cb;
  cb?.([...decisions]);
}
function logDecision(d: Omit<Decision, "at">) {
  decisions.push({ ...d, at: Date.now() });
  if (decisions.length > 60) decisions.shift();
  if (d.outcome === "dropped") droppedCount++;
  decisionCb?.([...decisions]);
}

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
async function insertLine(member: Member, text: string, loudness: number, confidence: number, delayMs: number): Promise<string | null> {
  const { data, error } = await supabase.rpc("insert_line", {
    p_room_id: member.room_id,
    p_speaker_id: member.id,
    p_text: text,
    p_language: member.language,
    p_loudness: loudness,
    p_confidence: confidence,
    p_delay_ms: Math.round(delayMs),
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
let voiceRoom: string | null = null;
let shareTimer: ReturnType<typeof setInterval> | null = null;
const others = new Map<string, { level: number; at: number }[]>();
let talkingCb: ((ids: string[]) => void) | null = null;
const talkingAt = new Map<string, number>();
let watchingTalk = false;

/** One broadcast channel per room for live mic levels + "is talking" (not a room table, so outside useRoom). */
function ensureVoiceChannel(roomId: string) {
  if (voiceChannel && voiceRoom === roomId) return voiceChannel;
  if (voiceChannel) void supabase.removeChannel(voiceChannel);
  others.clear();
  voiceRoom = roomId;
  voiceChannel = supabase.channel(`voice-${roomId}`, { config: { broadcast: { self: false } } });
  voiceChannel
    .on("broadcast", { event: "level" }, ({ payload }) => {
      const p = payload as { id: string; level: number; talking?: boolean };
      if (!p?.id) return;
      const now = performance.now();
      const list = (others.get(p.id) ?? []).filter((x) => now - x.at < 600);
      list.push({ level: p.level, at: now });
      others.set(p.id, list);
      if (p.talking) talkingAt.set(p.id, now);
    })
    .subscribe();
  return voiceChannel;
}
function releaseVoiceChannel() {
  if (wanted || watchingTalk || !voiceChannel) return;
  void supabase.removeChannel(voiceChannel);
  voiceChannel = null;
  voiceRoom = null;
}

/** Live "who is talking right now" for the room (shown instantly, before the caption arrives). */
export function watchTalking(roomId: string, cb: (ids: string[]) => void) {
  watchingTalk = true;
  talkingCb = cb;
  ensureVoiceChannel(roomId);
  const t = setInterval(() => {
    const now = performance.now();
    talkingCb?.([...talkingAt.entries()].filter(([, at]) => now - at < 700).map(([id]) => id));
  }, 200);
  return () => { clearInterval(t); watchingTalk = false; talkingCb = null; releaseVoiceChannel(); };
}

/** Shares this phone's live mic level with the other phones at the table and tracks theirs,
 *  so each phone knows, moment by moment, whether it is the one closest to whoever is talking. */
function joinVoiceLevels(member: Member) {
  const ch = ensureVoiceChannel(member.room_id);
  let windowMax = 0;
  let talking = false;
  shareTimer = setInterval(() => {
    ch.send({ type: "broadcast", event: "level", payload: { id: member.id, level: windowMax, talking } });
    if (talking) talkingAt.set(member.id, performance.now());
    windowMax = 0;
    talking = false;
  }, 150);
  return {
    note: (f: Frame) => { windowMax = Math.max(windowMax, f.rms); if (f.speech && f.loudest) talking = true; },
    /** Loudest level each other phone reported in the last ~450ms (covers network delay). */
    othersNow: () => {
      const now = performance.now();
      return [...others.entries()].filter(([id]) => id !== member.id)
        .map(([, l]) => Math.max(0, ...l.filter((x) => now - x.at < 450).map((x) => x.level)));
    },
  };
}

/** What this phone learned about its owner's voice (from confident lines and from speaker corrections).
 *  Kept per member in this browser — levels are specific to the phone that measured them. */
const learnKey = (memberId: string) => `gamige-voice-learn:${memberId}`;
export function loadLearning(memberId: string): VoiceLearning {
  try {
    const v = JSON.parse(localStorage.getItem(learnKey(memberId)) ?? "null");
    if (v && Array.isArray(v.own)) return v;
  } catch { /* ignore */ }
  return { own: [], notMine: [], seen: [] };
}
function saveLearning(memberId: string, l: VoiceLearning) {
  localStorage.setItem(learnKey(memberId), JSON.stringify(l));
}
/** Feed a speaker correction on a line this phone captured back into its attribution. */
export function learnCorrection(memberId: string, correctionId: string, level: number, wasOwner: boolean) {
  const next = learnFromCorrection(loadLearning(memberId), correctionId, level, wasOwner);
  saveLearning(memberId, next);
  return next;
}

/** Decides and saves one captured utterance. Shared by both speech engines. */
async function handleUtterance(
  member: Member, frames: Frame[], speechEnd: number, transcribe: () => Promise<{ text: string; language: string | null } | null>,
  onError: (msg: string) => void,
) {
  const speech = frames.filter((x) => x.speech);
  const level = speakingLevel(speech.map((x) => x.rms));
  const share = speech.length ? speech.filter((x) => x.loudest).length / speech.length : 0;
  const learned = loadLearning(member.id);
  const ref = ownVoiceRef(member.voice_level, learned.own);
  const verdict = attribute(level, ref, share, learned.notMine);
  const base = { level, ref, share, confidence: verdict.confidence };
  if (verdict.decision === "drop") {
    logDecision({ ...base, text: "", outcome: "dropped", reason: share < 0.4 ? "another phone was closer" : "too faint — room noise", delayMs: null });
    debugCb?.({ rms: lastPeak, threshold: ref ? 0.3 * ref : 0, dropped: droppedCount });
    return;
  }
  try {
    const res = await transcribe();
    if (!res) return;
    const clean = cleanTranscript(res.text, member.language);
    if (!clean) return;
    if (!keepByLanguage(res.language, member.language)) {
      logDecision({ ...base, text: res.text, outcome: "dropped", reason: `other language (${res.language})`, delayMs: null });
      return;
    }
    const lineId = await insertLine(member, clean, level, verdict.confidence, performance.now() - speechEnd);
    const delayMs = performance.now() - speechEnd;
    if (!lineId) { logDecision({ ...base, text: clean, outcome: "dropped", reason: "another phone had it louder", delayMs }); return; }
    if (verdict.decision === "keep") {
      const l = loadLearning(member.id);
      saveLearning(member.id, { ...l, own: [...l.own, level].slice(-30) });
    }
    logDecision({ ...base, text: clean, outcome: verdict.decision === "keep" ? "kept" : "unknown", reason: verdict.decision === "keep" ? "sounds like you" : "not sure it was you", delayMs });
    call({ task: "translate", lineId }).catch((err) => onError(err.message));
  } catch (e) {
    onError(e instanceof Error ? e.message : "Couldn't save what you said.");
  }
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
  const threshold = member.voice_level ? 0.3 * member.voice_level : 0;
  // A frame counts as speech above this level (never below a fixed silence floor).
  const speechLevel = Math.max(0.01, threshold * 0.8);
  let lastSpeechAt = performance.now();
  const levels = joinVoiceLevels(member);
  let recent: number[] = []; // my last ~150ms of frames, compared with the other phones' 150ms maxima
  let frames: Frame[] = [];
  const takeFrames = () => { const f = frames; frames = []; return f; };
  let onFrame: ((f: Frame) => void) | null = null;
  const sample = () => {
    if (!audioCtx) return;
    analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    recent.push(rms);
    if (recent.length > 9) recent = recent.slice(-9);
    const f: Frame = { rms, speech: rms >= speechLevel, loudest: isLoudestFrame(Math.max(...recent), levels.othersNow()) };
    levels.note(f);
    if (f.speech) lastSpeechAt = performance.now();
    frames.push(f);
    if (frames.length > 1200) frames.shift();
    onFrame?.(f);
    lastPeak = rms;
    debugCb?.({ rms, threshold, dropped: droppedCount });
    requestAnimationFrame(sample);
  };
  sample();

  if (engine === "gemini") {
    onFrame = startGeminiMic(member, micStream, takeFrames, onError);
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
      if (!keepByConfidence(r[0].confidence ?? 0)) {
        logDecision({ text, level: 0, ref: null, share: 0, confidence: 0, outcome: "dropped", reason: "low recognition confidence", delayMs: null });
        continue;
      }
      void handleUtterance(member, f, lastSpeechAt, async () => ({ text, language: null }), onError);
    }
    onInterim(interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") { wanted = false; onError("Microphone permission was denied."); }
  };
  rec.onend = () => { if (wanted) rec?.start(); };
  rec.start();
}

/** Gemini recorder, cut by voice activity: a chunk ends ~0.4s after the speaker pauses (or at 4.5s, so long
 *  talkers get captions as they go), so phrases go out right away and words aren't split.
 *  A phone only uploads chunks it "owns" — it was the loudest phone for enough of the speech. */
const PAUSE_MS = 400;
const MAX_CHUNK_MS = 4500;
const IDLE_RECYCLE_MS = 4000;
function startGeminiMic(member: Member, stream: MediaStream, takeFrames: () => Frame[], onError: (msg: string) => void): (f: Frame) => void {
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
    c.r.onstop = () => {
      if (!wanted || !c.chunks.length) return;
      const blob = new Blob(c.chunks, { type: mime || "audio/webm" });
      void handleUtterance(member, frames, c.lastSpeech, () => transcribeChunk(blob, member.language as Lang), onError);
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
  releaseVoiceChannel();
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
