/** Durable reservations use existing note IDs: competing phones cannot buy the same slot. */
export const ROAST_MEME_LIMIT = 3;
export const ROAST_MEME_COOLDOWN_MS = 5 * 60_000;
export const ROAST_MEME_CHANCE = 0.25;
export const ROAST_MEME_PREFIX = "🎨 Roast painting: ";
export function roastMemeAllowed(attempts: { created_at: string; content: string }[], now: number) {
  if (attempts.length >= ROAST_MEME_LIMIT || attempts.some((a) => a.content.includes("[paused]"))) return false;
  return attempts.every((a) => now - Date.parse(a.created_at) >= ROAST_MEME_COOLDOWN_MS);
}
export async function roastSlotId(roomId: string, slot: number) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`roast-meme:${roomId}:${slot}`)));
  hash[6] = ((hash[6] ?? 0) & 15) | 80;
  hash[8] = ((hash[8] ?? 0) & 63) | 128;
  const h = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}