import { describe, expect, it } from "vitest";
import { arbitrate, classifyMicError, keepByConfidence, keepByLanguage, needsRecalibration, passesVoiceGate, VOICE_GATE } from "./crosstalk";

describe("keepByLanguage (Gemini detected language)", () => {
  it("keeps a chunk whose detected language matches the member", () => {
    expect(keepByLanguage("ka", "ka")).toBe(true);
  });
  it("drops a chunk whose detected language differs (neighbour's voice)", () => {
    expect(keepByLanguage("en", "ka")).toBe(false);
  });
  it("keeps the chunk when no language was detected", () => {
    expect(keepByLanguage(null, "ka")).toBe(true);
    expect(keepByLanguage(undefined, "en")).toBe(true);
  });
});

describe("keepByConfidence (Web Speech)", () => {
  it("drops results below 0.5 confidence", () => {
    expect(keepByConfidence(0.3)).toBe(false);
    expect(keepByConfidence(0.49)).toBe(false);
  });
  it("keeps results at or above 0.5 confidence", () => {
    expect(keepByConfidence(0.5)).toBe(true);
    expect(keepByConfidence(0.92)).toBe(true);
  });
  it("ignores confidence when the browser always reports 0", () => {
    expect(keepByConfidence(0)).toBe(true);
  });
});

describe("passesVoiceGate (30% floor of calibrated voice_level)", () => {
  it("passes speech at or above 30% of voice_level", () => {
    expect(passesVoiceGate(0.03, 0.1)).toBe(true);
    expect(passesVoiceGate(0.06, 0.1)).toBe(true);
    expect(VOICE_GATE).toBe(0.3);
  });
  it("drops speech quieter than 30% of voice_level", () => {
    expect(passesVoiceGate(0.02, 0.1)).toBe(false);
  });
  it("does not silence someone whose setup came out 3x louder than their talking", () => {
    // Kato calibrated at 0.171 but talked around 0.06 — the old 60% gate dropped all of it.
    expect(passesVoiceGate(0.06, 0.171)).toBe(true);
  });
  it("passes everything when the member never calibrated", () => {
    expect(passesVoiceGate(0.001, null)).toBe(true);
    expect(passesVoiceGate(0.001, undefined)).toBe(true);
  });
});

describe("arbitrate (loudest phone wins, relative to voice_level)", () => {
  it("keeps my line when I am relatively louder", () => {
    expect(arbitrate({ loudness: 0.8, voiceLevel: 0.1 }, { loudness: 0.5, voiceLevel: 0.1 })).toBe("keep-mine");
  });
  it("keeps the other line when they are relatively louder", () => {
    expect(arbitrate({ loudness: 0.3, voiceLevel: 0.1 }, { loudness: 0.7, voiceLevel: 0.1 })).toBe("keep-other");
  });
  it("compares relative to each phone's calibration, not raw loudness", () => {
    // I sound quiet in absolute terms but I'm loud for my phone; the other phone just hears me from afar.
    expect(arbitrate({ loudness: 0.09, voiceLevel: 0.1 }, { loudness: 0.2, voiceLevel: 0.4 })).toBe("keep-mine");
  });
  it("treats missing calibration as 1 (raw loudness compare)", () => {
    expect(arbitrate({ loudness: 0.4, voiceLevel: null }, { loudness: 0.6, voiceLevel: null })).toBe("keep-other");
  });
});

describe("classifyMicError (recovery states)", () => {
  it("maps permission denial", () => {
    expect(classifyMicError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyMicError({ name: "SecurityError" })).toBe("denied");
  });
  it("maps device disconnects and busy devices", () => {
    expect(classifyMicError({ name: "NotFoundError" })).toBe("disconnected");
    expect(classifyMicError({ name: "NotReadableError" })).toBe("disconnected");
    expect(classifyMicError({ name: "OverconstrainedError" })).toBe("disconnected");
  });
  it("maps missing APIs to unsupported", () => {
    expect(classifyMicError(new TypeError("navigator.mediaDevices is undefined"))).toBe("unsupported");
  });
  it("falls back to unknown", () => {
    expect(classifyMicError(new Error("boom"))).toBe("unknown");
  });
});

describe("needsRecalibration (phone-change flag)", () => {
  it("flags members who never calibrated", () => {
    expect(needsRecalibration({ voice_level: null, voice_device: null }, "iPhone/iPad · Safari")).toBe(true);
  });
  it("flags a calibration made on a different device", () => {
    expect(needsRecalibration({ voice_level: 0.1, voice_device: "Android · Chromium" }, "iPhone/iPad · Safari")).toBe(true);
  });
  it("does not flag a calibration made on the same device", () => {
    expect(needsRecalibration({ voice_level: 0.1, voice_device: "iPhone/iPad · Safari" }, "iPhone/iPad · Safari")).toBe(false);
  });
});

import { findOverlaps, speakingLevel } from "./crosstalk";

describe("speakingLevel", () => {
  it("averages the louder half of frames", () => {
    expect(speakingLevel([0.1, 0.2, 0.0, 0.0])).toBeCloseTo(0.15);
  });
  it("is 0 for no frames", () => {
    expect(speakingLevel([])).toBe(0);
  });
});

describe("findOverlaps", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();
  it("marks lines from different speakers within 3 seconds as overlapping", () => {
    const o = findOverlaps([
      { id: "a", speaker_id: "ani", created_at: t(0) },
      { id: "b", speaker_id: "kato", created_at: t(2) },
      { id: "c", speaker_id: "ani", created_at: t(10) },
    ]);
    expect([...o].sort()).toEqual(["a", "b"]);
  });
  it("does not mark one speaker's consecutive lines", () => {
    expect(findOverlaps([
      { id: "a", speaker_id: "ani", created_at: t(0) },
      { id: "b", speaker_id: "ani", created_at: t(1) },
    ]).size).toBe(0);
  });
});

import { cleanTranscript, isLoudestFrame, ownsChunk } from "./crosstalk";

describe("live loudest-phone check", () => {
  it("a frame is mine when I hear it at least ~as loud as every other phone", () => {
    expect(isLoudestFrame(0.08, [0.03])).toBe(true);
    expect(isLoudestFrame(0.03, [0.08])).toBe(false);
    expect(isLoudestFrame(0.05, [])).toBe(true);
  });
  it("the neighbour's phone does not own a chunk it only overheard", () => {
    const f = Array.from({ length: 10 }, (_, i) => ({ speech: true, loudest: i < 2 }));
    expect(ownsChunk(f)).toBe(false);
  });
  it("the speaker's phone owns the chunk, also when both talk at once", () => {
    const f = Array.from({ length: 10 }, (_, i) => ({ speech: true, loudest: i < 5 }));
    expect(ownsChunk(f)).toBe(true);
  });
  it("silence-only chunks are never uploaded", () => {
    expect(ownsChunk([{ speech: false, loudest: true }])).toBe(false);
  });
});

describe("cleanTranscript", () => {
  it("strips stray letters from other scripts in Georgian text", () => {
    expect(cleanTranscript("მე მგوني ჩვენი", "ka")).toBe("მე მგ ჩვენი");
  });
  it("drops a chunk that came back mostly in another script", () => {
    expect(cleanTranscript("那么同样面临着摄影的方面", "ka")).toBe("");
  });
  it("keeps normal Georgian", () => {
    expect(cleanTranscript("აბა რას შვებით?", "ka")).toBe("აბა რას შვებით?");
  });
});

import { attribute, delayStats, KNOWN_SPEAKER_CONFIDENCE, ownVoiceRef } from "./crosstalk";

describe("ownVoiceRef", () => {
  it("uses the voice setup until 3 own lines exist", () => {
    expect(ownVoiceRef(0.15, [0.2, 0.2])).toBe(0.15);
  });
  it("learns from own lines, but never below half the setup (bad loud setup can't silence)", () => {
    expect(ownVoiceRef(0.171, [0.06, 0.06, 0.06])).toBeCloseTo(0.0855);
  });
  it("never above 1.5x the setup", () => {
    expect(ownVoiceRef(0.1, [0.4, 0.4, 0.4])).toBeCloseTo(0.15);
  });
});

describe("attribute (crowded room)", () => {
  it("credits the owner talking close to their phone", () => {
    expect(attribute(0.19, 0.2, 1).decision).toBe("keep");
  });
  it("chatter from across the room (half the owner's level) becomes Unknown speaker, not the silent owner", () => {
    const r = attribute(0.074, 0.2, 1);
    expect(r.decision).toBe("unknown");
    expect(r.confidence).toBeLessThan(KNOWN_SPEAKER_CONFIDENCE);
  });
  it("faint room noise is dropped", () => {
    expect(attribute(0.04, 0.2, 1).decision).toBe("drop");
  });
  it("speech another table phone heard louder is dropped here", () => {
    expect(attribute(0.2, 0.2, 0.2).decision).toBe("drop");
  });
  it("a chunk this phone only partly owned is unknown", () => {
    expect(attribute(0.2, 0.2, 0.45).decision).toBe("unknown");
  });
  it("Unknown threshold is 0.7", () => {
    expect(KNOWN_SPEAKER_CONFIDENCE).toBe(0.7);
  });
});

describe("delayStats", () => {
  it("median and p90", () => {
    expect(delayStats([1000, 1200, 1400, 1600, 5000])).toEqual({ median: 1400, p90: 5000 });
  });
});
