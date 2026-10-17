import { describe, expect, it } from "vitest";
import { checkInvite } from "./invites";

const now = new Date("2026-10-17T20:00:00Z");
const live = { status: "live" as const };
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString();

describe("invite links", () => {
  it("works before its 12-hour expiry", () => {
    expect(checkInvite({ expires_at: hoursFromNow(1), revoked_at: null }, live, now)).toEqual({ ok: true });
  });
  it("stops working once expired", () => {
    expect(checkInvite({ expires_at: hoursFromNow(-0.01), revoked_at: null }, live, now)).toEqual({ ok: false, reason: "expired" });
  });
  it("stops working when the host revokes it", () => {
    expect(checkInvite({ expires_at: hoursFromNow(5), revoked_at: now.toISOString() }, live, now)).toEqual({ ok: false, reason: "revoked" });
  });
  it("rejects unknown links", () => {
    expect(checkInvite(null, null, now)).toEqual({ ok: false, reason: "missing" });
  });
});
