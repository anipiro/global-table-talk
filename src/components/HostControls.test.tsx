import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Member, Room } from "@/lib/room";

const mocks = vi.hoisted(() => ({
  update: vi.fn(), remove: vi.fn(), eq: vi.fn(), select: vi.fn(), execute: vi.fn(),
  success: vi.fn(), error: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: mocks.update, delete: mocks.remove }) },
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { GuestList } from "./HostControls";

const room: Room = { id: "room-1", code: "TEST", host_member_id: "host-1", status: "live", created_at: "2026-10-17T00:00:00Z" };
const guest: Member = {
  id: "guest-1", room_id: room.id, name: "Guest", language: "en", role: "both", facts: "",
  whisper_on: false, color: "", approved: false, created_at: room.created_at, can_speak: true, invite_id: null,
};

describe("Guest controls execute their writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = { eq: mocks.eq, select: mocks.select };
    mocks.update.mockReturnValue(query);
    mocks.remove.mockReturnValue(query);
    mocks.eq.mockReturnValue(query);
    // Like the real client, constructing a query does not send it: only awaiting does.
    mocks.select.mockReturnValue({ then: (resolve: (value: unknown) => void) => resolve(mocks.execute()) });
    mocks.execute.mockReturnValue({ data: [{ id: guest.id }], error: null });
  });
  afterEach(cleanup);

  it("executes approval with approved true, scoped to this room and guest", async () => {
    render(<GuestList room={room} members={[guest]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith({ approved: true });
    expect(mocks.eq).toHaveBeenCalledWith("room_id", "room-1");
    expect(mocks.eq).toHaveBeenCalledWith("id", "guest-1");
    expect(mocks.success).toHaveBeenCalled();
  });

  it("reports a failed approval and allows retrying", async () => {
    mocks.execute.mockReturnValue({ data: null, error: new Error("Connection lost") });
    render(<GuestList room={room} members={[guest]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Connection lost"));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("executes removal", async () => {
    render(<GuestList room={room} members={[guest]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it.each([true, false])("executes the mic permission change from %s", async (can_speak) => {
    render(<GuestList room={room} members={[{ ...guest, approved: true, can_speak }]} />);
    fireEvent.click(screen.getByRole("button", { name: can_speak ? "Mute" : "Allow mic" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith({ can_speak: !can_speak });
  });
});