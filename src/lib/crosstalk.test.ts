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

describe("passesVoiceGate (60% of calibrated voice_level)", () => {
  it("passes speech at or above 60% of voice_level", () => {
    expect(passesVoiceGate(0.06, 0.1)).toBe(true);
    expect(passesVoiceGate(VOICE_GATE * 0.1, 0.1)).toBe(true);
  });
  it("drops speech quieter than 60% of voice_level (crosstalk)", () => {
    expect(passesVoiceGate(0.05, 0.1)).toBe(false);
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
