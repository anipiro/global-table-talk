import { describe, expect, it } from "vitest";
import { mediaByLine, mediaCaption } from "./Media";
import type { Media } from "@/lib/room";

const row = (o: Partial<Media>): Media => ({
  id: "m1", room_id: "r1", line_id: null, notebook_id: null, kind: "reference_image",
  query: "Kakheti", url: "https://example.org/kakheti.jpg", caption_by_language: {}, credit: "Wikipedia",
  created_by_member_id: null, created_at: "2026-10-17T16:00:00Z", ...o,
});

describe("agent pictures in the live feed", () => {
  it("hangs each picture under the line that triggered it", () => {
    const by = mediaByLine([row({ id: "a", line_id: "L1" }), row({ id: "b", line_id: "L2" })]);
    expect([...by.keys()]).toEqual(["L1", "L2"]);
    expect(by.get("L1")!.map((m) => m.id)).toEqual(["a"]);
  });

  it("keeps both pictures when two are found for the same line", () => {
    const by = mediaByLine([row({ id: "a", line_id: "L1" }), row({ id: "b", line_id: "L1", kind: "meme" })]);
    expect(by.get("L1")!.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("leaves a picture with no triggering line out of the feed", () => {
    expect(mediaByLine([row({ id: "a" })]).size).toBe(0);
  });

  it("shows the caption in my language, then English, then anything the agents wrote", () => {
    const caps = { ka: "კახეთი", en: "Kakheti", ru: "Кахетия" };
    expect(mediaCaption(row({ caption_by_language: caps }), "ka")).toBe("კახეთი");
    expect(mediaCaption(row({ caption_by_language: caps }), "de")).toBe("Kakheti");
    expect(mediaCaption(row({ caption_by_language: { ru: "Кахетия" } }), "de")).toBe("Кахетия");
    expect(mediaCaption(row({}), "de")).toBe("");
  });
});
