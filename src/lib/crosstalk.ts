/** Pure crosstalk rules — shared by the mic engines and covered by automated tests. */

/** A chunk/utterance is only sent when its RMS is at least this fraction of the member's calibrated voice_level. */
export const VOICE_GATE = 0.6;

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

/** Voice gate: only send speech at least 60% as loud as the member's calibrated level. No calibration → no gate. */
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
