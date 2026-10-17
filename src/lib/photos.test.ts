import { describe, expect, it } from "vitest";
import { fitWithin, MAX_PHOTO_SIDE } from "./photos";

describe("photo compression size", () => {
  it("caps the longest side at 1600px", () => {
    expect(MAX_PHOTO_SIDE).toBe(1600);
    expect(fitWithin(4032, 3024)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ w: 1200, h: 1600 });
  });
  it("never upscales small photos", () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });
});
