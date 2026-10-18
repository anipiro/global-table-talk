import { describe, expect, it } from "vitest";
import { ROAST_MEME_CHANCE, ROAST_MEME_COOLDOWN_MS, ROAST_MEME_LIMIT, roastMemeAllowed, roastSlotId } from "./roastMemeBudget";
const now = Date.parse("2026-10-18T05:20:00Z");
const attempt = (ago: number, content = "done") => ({ created_at: new Date(now - ago).toISOString(), content });
describe("occasional credit-saving painted memes", () => {
  it("allows at most three attempts per room, including failures", () => {
    expect(ROAST_MEME_LIMIT).toBe(3);
    expect(roastMemeAllowed([attempt(900000), attempt(600000)], now)).toBe(true);
    expect(roastMemeAllowed([attempt(900000), attempt(600000), attempt(300000, "failed")], now)).toBe(false);
  });
  it("requires at least five minutes between attempts", () => {
    expect(ROAST_MEME_COOLDOWN_MS).toBe(300000);
    expect(roastMemeAllowed([attempt(299999)], now)).toBe(false);
    expect(roastMemeAllowed([attempt(300000)], now)).toBe(true);
  });
  it("samples only one quarter of eligible jokes", () => { expect(ROAST_MEME_CHANCE).toBe(0.25); });
  it("keeps credit and provider failures paused", () => { expect(roastMemeAllowed([attempt(900000, "[paused] denied")], now)).toBe(false); });
  it("all phones claim the same unique slot but different rooms do not", async () => {
    const a = await roastSlotId("room-a", 0);
    expect(await roastSlotId("room-a", 0)).toBe(a);
    expect(await roastSlotId("room-a", 1)).not.toBe(a);
    expect(await roastSlotId("room-b", 0)).not.toBe(a);
    expect(a).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  });
});