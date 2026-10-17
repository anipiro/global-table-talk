import { supabase } from "@/integrations/supabase/client";
import type { Lang, Member } from "./room";

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

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onend: () => void; onerror: (e: { error: string }) => void; start: () => void; stop: () => void;
};
let rec: Rec | null = null;
let micStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let wanted = false;

export const micSupported = () =>
  typeof window !== "undefined" && !!((window as never)["SpeechRecognition"] || (window as never)["webkitSpeechRecognition"]);

/** Listens on this phone's mic, writes each finished sentence as a line, and asks the agents to translate it. */
export async function startMic(
  member: Member,
  onInterim: (text: string) => void,
  onError: (msg: string) => void,
) {
  const SR = (window as never)["SpeechRecognition"] || (window as never)["webkitSpeechRecognition"];
  if (!SR) throw new Error("Live captions need Chrome, Edge or Safari on this phone.");
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(micStream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let peak = 0;
  const sample = () => {
    if (!audioCtx) return;
    analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    peak = Math.max(peak * 0.98, rms);
    requestAnimationFrame(sample);
  };
  sample();

  wanted = true;
  rec = new (SR as new () => Rec)();
  rec.lang = SPEECH_LANG[member.language as Lang] ?? "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = async (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript.trim();
      if (!r.isFinal) { interim += text + " "; continue; }
      if (!text) continue;
      const loudness = Math.min(1, peak * 4);
      peak = 0;
      const { data, error } = await supabase
        .from("lines")
        .insert({ room_id: member.room_id, speaker_id: member.id, text, language: member.language, loudness })
        .select("id").single();
      if (error) onError("Couldn't save what you said.");
      else call({ task: "translate", lineId: data.id }).catch((err) => onError(err.message));
    }
    onInterim(interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") { wanted = false; onError("Microphone permission was denied."); }
  };
  rec.onend = () => { if (wanted) rec?.start(); };
  rec.start();
}

export async function stopMic() {
  wanted = false;
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
