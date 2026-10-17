import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Room } from "./room";

export type Invite = Database["public"]["Tables"]["invites"]["Row"];
export const INVITE_HOURS = 12;

export type InviteCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "revoked" | "expired" | "ended" };

/** Pure rule: a link works while it exists, isn't revoked, is under 12h old, and the night hasn't ended. */
export function checkInvite(
  invite: Pick<Invite, "expires_at" | "revoked_at"> | null,
  room: Pick<Room, "status"> | null,
  now: Date = new Date(),
): InviteCheck {
  if (!invite || !room) return { ok: false, reason: "missing" };
  if (invite.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (room.status === "ended") return { ok: false, reason: "ended" };
  return { ok: true };
}

export const INVITE_ERRORS: Record<string, string> = {
  missing: "This invite link doesn't exist.",
  revoked: "The host turned off this invite link.",
  expired: "This invite link has expired. Ask the host for a new one.",
  ended: "This dinner has already ended.",
};

export const inviteLink = (token: string) => `${window.location.origin}/i/${token}`;

export async function createInvite(roomId: string, memberId: string) {
  const { data, error } = await supabase.from("invites").insert({ room_id: roomId, created_by: memberId }).select().single();
  if (error) throw error;
  return data;
}

export async function revokeInvite(id: string) {
  const { error } = await supabase.from("invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function loadInvite(token: string) {
  const { data } = await supabase.from("invites").select("*, rooms(*)").eq("token", token).maybeSingle();
  if (!data) return { invite: null, room: null };
  const { rooms, ...invite } = data;
  return { invite: invite as Invite, room: rooms as Room | null };
}

export async function shareLink(url: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "Join my table on Gamige", url });
      return "shared";
    } catch {
      /* fall back to copy */
    }
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}
