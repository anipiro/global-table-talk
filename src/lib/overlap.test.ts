import { describe, expect, it } from "vitest";
import { activeAt, audibleLanes, schedule, scrubTarget, transcriptCsv, transcriptText } from "./overlap";

const t = (ms: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + ms).toISOString();
const segs = [
  { id: "a", speaker_id: "ani", created_at: t(0), text: "აბა რას შვებით, რა ხდება" },
  { id: "b", speaker_id: "kato", created_at: t(1500), text: "კარგად ვარ" },
  { id: "c", speaker_id: "ani", created_at: t(6000), text: "ოკეი" },
];

describe("audibleLanes", () => {
  it("solo plays only the soloed lane, even if it is muted", () => {
    expect([...audibleLanes(["ani", "kato"], new Set(["ani"]), "ani")]).toEqual(["ani"]);
  });
  it("mute removes a lane when nothing is soloed", () => {
    expect([...audibleLanes(["ani", "kato"], new Set(["kato"]), null)]).toEqual(["ani"]);
  });
});

describe("schedule keeps relative timing", () => {
  it("starts each segment at its offset from the first", () => {
    expect(schedule(segs).map((p) => p.at)).toEqual([0, 1500, 6000]);
  });
  it("speed 2 halves every offset", () => {
    expect(schedule(segs, 2).map((p) => p.at)).toEqual([0, 750, 3000]);
  });
  it("shortens long silences but keeps overlap timing", () => {
    expect(schedule(segs, 1, 3000).map((p) => p.at)).toEqual([0, 1500, 4500]);
  });
  it("overlapping segments from two lanes are active at the same time", () => {
    expect([...activeAt(schedule(segs), 1600)].sort()).toEqual(["a", "b"]);
  });
});

describe("scrubTarget", () => {
  const plan = schedule(segs);
  it("jumps to the next segment start", () => {
    expect(scrubTarget(plan, 0, 1)).toBe(1500);
  });
  it("jumps back to the previous segment start", () => {
    expect(scrubTarget(plan, 6000, -1)).toBe(1500);
  });
});

describe("transcript export", () => {
  const rows = [
    { at: "2026-10-17T12:22:15.505Z", speaker: "Ani", language: "ka", text: "რატომ, ხო?", unsure: true, overlap: true, corrected: false },
    { at: "2026-10-17T12:22:18.571Z", speaker: "Kato", language: "ka", text: 'say "hi"', translation: "hi", unsure: false, overlap: false, corrected: true },
  ];
  it("CSV keeps timestamps, speaker labels and flags, quoting commas and quotes", () => {
    const csv = transcriptCsv(rows).split("\n");
    expect(csv[0]).toBe("timestamp,speaker,language,text,translation,unsure_speaker,overlap,corrected");
    expect(csv[1]).toBe('2026-10-17T12:22:15.505Z,Ani,ka,"რატომ, ხო?",,yes,yes,no');
    expect(csv[2]).toBe('2026-10-17T12:22:18.571Z,Kato,ka,"say ""hi""",hi,no,no,yes');
  });
  it("text marks unsure speakers", () => {
    expect(transcriptText(rows, () => "12:22:15").split("\n")[0]).toBe("[12:22:15] Ani (?): რატომ, ხო?");
  });
});
