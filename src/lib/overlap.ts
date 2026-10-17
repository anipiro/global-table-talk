/** Pure helpers for the overlap view: lanes, playback timing, and solo/mute. */

export type Seg = { id: string; speaker_id: string | null; created_at: string; text: string; ambiguous?: boolean };

/** Lanes a segment should be heard from: solo wins over mute; with no solo, every unmuted lane plays. */
export function audibleLanes(laneIds: string[], muted: Set<string>, solo: string | null): Set<string> {
  if (solo) return new Set([solo]);
  return new Set(laneIds.filter((id) => !muted.has(id)));
}

/** Playback schedule: each segment starts at its real offset from the previous one (ms),
 *  so overlapping lanes keep their relative timing. Silences longer than maxGapMs are shortened
 *  to maxGapMs (nobody wants to wait through a quiet minute). Speed > 1 compresses time. */
export function schedule(segs: Seg[], speed = 1, maxGapMs = Infinity): { seg: Seg; at: number }[] {
  const sorted = [...segs].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  let at = 0;
  let prev: number | null = null;
  return sorted.map((seg) => {
    const t = Date.parse(seg.created_at);
    if (prev !== null) at += Math.min(t - prev, maxGapMs) / speed;
    prev = t;
    return { seg, at };
  });
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

export type ExportRow = { at: string; speaker: string; language: string; text: string; translation?: string; unsure: boolean; overlap: boolean; corrected: boolean };

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Reviewed transcript as CSV (one row per line, ISO timestamps, speaker labels and review flags). */
export function transcriptCsv(rows: ExportRow[]): string {
  const head = ["timestamp", "speaker", "language", "text", "translation", "unsure_speaker", "overlap", "corrected"];
  const body = rows.map((r) => [r.at, r.speaker, r.language, r.text, r.translation ?? "", r.unsure ? "yes" : "no", r.overlap ? "yes" : "no", r.corrected ? "yes" : "no"].map(csvCell).join(","));
  return [head.join(","), ...body].join("\n") + "\n";
}

/** Reviewed transcript as readable text: "[12:22:15] Ani: …", unsure lines marked with "(?)". */
export function transcriptText(rows: ExportRow[], fmt: (iso: string) => string): string {
  return rows.map((r) => `[${fmt(r.at)}] ${r.speaker}${r.unsure ? " (?)" : ""}: ${r.text}${r.translation ? `\n    → ${r.translation}` : ""}`).join("\n") + "\n";
}
