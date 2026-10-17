/** Pure helpers for the overlap view: lanes, playback timing, and solo/mute. */

export type Seg = { id: string; speaker_id: string | null; created_at: string; text: string; ambiguous?: boolean };

/** Lanes a segment should be heard from: solo wins over mute; with no solo, every unmuted lane plays. */
export function audibleLanes(laneIds: string[], muted: Set<string>, solo: string | null): Set<string> {
  if (solo) return new Set([solo]);
  return new Set(laneIds.filter((id) => !muted.has(id)));
}

/** Playback schedule: each segment starts at its real offset from the first segment (ms),
 *  so overlapping lanes keep their relative timing. Speed > 1 compresses time. */
export function schedule(segs: Seg[], speed = 1): { seg: Seg; at: number }[] {
  const sorted = [...segs].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  if (!sorted.length) return [];
  const t0 = Date.parse(sorted[0]!.created_at);
  return sorted.map((seg) => ({ seg, at: (Date.parse(seg.created_at) - t0) / speed }));
}

/** Estimated spoken duration of a segment (for highlighting while it plays), in ms at speed 1. */
export const spokenMs = (text: string) => Math.max(900, text.trim().split(/\s+/).length * 420);

/** Segments active at playback position `pos` (ms from start, speed already applied). */
export function activeAt(plan: { seg: Seg; at: number }[], pos: number, speed = 1): Set<string> {
  const out = new Set<string>();
  for (const { seg, at } of plan) if (pos >= at && pos < at + spokenMs(seg.text) / speed) out.add(seg.id);
  return out;
}

/** Next/previous segment start for scrubbing (from position `pos`). */
export function scrubTarget(plan: { at: number }[], pos: number, dir: 1 | -1): number {
  if (!plan.length) return 0;
  if (dir === 1) return plan.find((p) => p.at > pos + 1)?.at ?? plan[plan.length - 1]!.at;
  const prev = [...plan].reverse().find((p) => p.at < pos - 1);
  return prev?.at ?? 0;
}
