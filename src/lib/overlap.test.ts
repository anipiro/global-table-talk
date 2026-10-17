import { describe, expect, it } from "vitest";
import { activeAt, audibleLanes, schedule, scrubTarget } from "./overlap";

const t = (ms: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + ms).toISOString();
const segs = [
  { id: "a", speaker_id: "ani", created_at: t(0), text: "აბა რას შვებით" },
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
