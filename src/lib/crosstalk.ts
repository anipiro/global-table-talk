/** Pure crosstalk rules — shared by the mic engines and covered by automated tests. */

/** Soft floor: a chunk/utterance is only sent when its level is at least this fraction of the member's
 *  calibrated voice_level. Kept lenient — iPhones calibrate very differently, and a strict gate silenced people. */
export const VOICE_GATE = 0.3;

/** Web Speech results below this confidence are dropped (likely the other person's voice). */
export const MIN_CONFIDENCE = 0.5;

/** How far back to look for a competing line from another phone (loudest-phone-wins). */
export const ARBITRATION_WINDOW_MS = 2000;

/** Gemini: keep only results whose detected language matches the member's own language. */
export function keepByLanguage(detected: string | null | undefined, memberLang: string): boolean {
  if (!detected) return true; // no detection info — keep
  return detected === memberLang;
}

/** Web Speech: drop low-confidence results; ignore confidence entirely when the browser always reports 0. */
export function keepByConfidence(confidence: number): boolean {
  if (confidence === 0) return true; // browser gives no confidence signal
  return confidence >= MIN_CONFIDENCE;
}

/** Voice floor: only send speech at least 30% as loud as the member's calibrated level. No calibration → no gate. */
export function passesVoiceGate(utteranceRms: number, voiceLevel: number | null | undefined): boolean {
  if (!voiceLevel) return true;
  return utteranceRms >= VOICE_GATE * voiceLevel;
}

/** Loudest phone wins: compare loudness relative to each member's calibrated voice level. */
export function arbitrate(
  mine: { loudness: number; voiceLevel: number | null | undefined },
  other: { loudness: number; voiceLevel: number | null | undefined },
): "keep-mine" | "keep-other" {
  const rel = (x: { loudness: number; voiceLevel: number | null | undefined }) =>
    x.loudness / (x.voiceLevel || 1);
  return rel(mine) >= rel(other) ? "keep-mine" : "keep-other";
}

/** Maps a getUserMedia / recorder failure to a recovery state the UI can explain. */
export function classifyMicError(e: unknown): "denied" | "disconnected" | "unsupported" | "unknown" {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError" || name === "AbortError") return "disconnected";
  if (name === "TypeError" && e instanceof TypeError) return "unsupported";
  return "unknown";
}

/** True when the member calibrated on a different device (or never calibrated) and should recalibrate. */
export function needsRecalibration(
  member: { voice_level: number | null; voice_device: string | null },
  currentDevice: string,
): boolean {
  if (!member.voice_level) return true;
  return !!member.voice_device && member.voice_device !== currentDevice;
}

/** Speaking level of an utterance: average RMS of the louder half of analyser frames.
 *  Used both for calibration and for each chunk, so the 60% gate compares like with like. */
export function speakingLevel(frames: number[]): number {
  if (!frames.length) return 0;
  const sorted = [...frames].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
  return top.reduce((s, v) => s + v, 0) / top.length;
}

/** Window in which lines from different speakers count as overlapping speech. */
export const OVERLAP_WINDOW_MS = 3000;

/** Ids of lines that overlap in time with a line from a different speaker. */
export function findOverlaps(lines: { id: string; speaker_id: string | null; created_at: string }[], windowMs = OVERLAP_WINDOW_MS): Set<string> {
  const sorted = [...lines].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const out = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const ta = Date.parse(a.created_at);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (Date.parse(b.created_at) - ta > windowMs) break;
      if (b.speaker_id !== a.speaker_id) { out.add(a.id); out.add(b.id); }
    }
  }
  return out;
}

/** Live "loudest phone" check: phones share their raw mic level a few times a second. A frame belongs to
 *  this phone when it hears the sound at least about as loud as any other phone (within `tolerance`). */
export function isLoudestFrame(mine: number, others: number[], tolerance = 0.85): boolean {
  const top = Math.max(0, ...others);
  return mine >= top * tolerance;
}

/** Fraction of speech frames in which this phone was the loudest needed to upload a chunk. Two people
 *  talking at once are each loudest on their own phone, so both still go through. */
export const OWN_SPEECH_SHARE = 0.4;

/** Decides whether this phone owns a chunk: enough of its speech frames were loudest here. */
export function ownsChunk(frames: { speech: boolean; loudest: boolean }[], share = OWN_SPEECH_SHARE): boolean {
  const speech = frames.filter((f) => f.speech);
  if (!speech.length) return false;
  return speech.filter((f) => f.loudest).length / speech.length >= share;
}

const SCRIPTS: Record<string, RegExp> = {
  ka: /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]/u,
  ru: /[\u0400-\u04FF]/u,
  en: /[A-Za-z]/,
};

/** Cleans a transcript for the speaker's language: strips letters from unrelated scripts (the transcriber
 *  sometimes hallucinates Arabic/Gurmukhi/Chinese characters) and returns "" when most letters were foreign. */
export function cleanTranscript(text: string, lang: string): string {
  const own = SCRIPTS[lang];
  if (!own) return text.trim();
  let ownCount = 0, foreign = 0;
  const kept = [...text].filter((ch) => {
    if (!/\p{L}/u.test(ch)) return true;
    if (own.test(ch) || /[A-Za-z]/.test(ch)) { ownCount++; return true; }
    foreign++;
    return false;
  }).join("");
  if (ownCount === 0 || foreign > ownCount) return "";
  return kept.replace(/\s+/g, " ").trim();
}
