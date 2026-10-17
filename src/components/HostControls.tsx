import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Member, Room } from "@/lib/room";
import { checkInvite, createInvite, inviteLink, revokeInvite, shareLink, type Invite } from "@/lib/invites";
import { fmtTime } from "@/lib/useRoom";
import { Button } from "@/components/ui/button";
import { findSharedGround } from "@/lib/agent";

export function useInvites(roomId: string | undefined) {
  const [invites, setInvites] = useState<Invite[]>([]);
  useEffect(() => {
    if (!roomId) return;
    const load = () =>
      supabase.from("invites").select().eq("room_id", roomId).order("created_at", { ascending: false }).then(({ data }) => setInvites(data ?? []));
    load();
    const ch = supabase
      .channel(`invites-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invites", filter: `room_id=eq.${roomId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [roomId]);
  return invites;
}

export function InvitePanel({ room, me }: { room: Room; me: Member }) {
  const invites = useInvites(room.id);
  const active = invites.filter((i) => checkInvite(i, room).ok);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Invite links</h3>
        <button
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          onClick={async () => {
            try {
              const inv = await createInvite(room.id, me.id);
              const r = await shareLink(inviteLink(inv.token));
              toast.success(r === "copied" ? "Link copied — works for 12 hours" : "Link shared");
            } catch {
              toast.error("Couldn't create a link");
            }
          }}
        >
          New link
        </button>
      </div>
      {active.length === 0 && <p className="text-sm text-muted-foreground">No active links. Guests can still use the table code.</p>}
      {active.map((i) => (
        <div key={i.id} className="flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">…/i/{i.token.slice(0, 8)}</p>
            <p className="text-xs text-muted-foreground">Expires {fmtTime(i.expires_at)} · used {i.uses}×</p>
          </div>
          <button className="rounded-full border px-3 py-1.5 text-sm" onClick={() => shareLink(inviteLink(i.token)).then((r) => r === "copied" && toast.success("Copied"))}>
            Share
          </button>
          <button className="rounded-full border border-destructive/50 px-3 py-1.5 text-sm text-destructive" onClick={() => revokeInvite(i.id).then(() => toast("Link turned off"))}>
            Revoke
          </button>
        </div>
      ))}
    </section>
  );
}

export function GuestList({ room, members }: { room: Room; members: Member[] }) {
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const pending = members.filter((m) => !m.approved);
  const seated = members.filter((m) => m.approved);
  const change = async (id: string, patch?: Partial<Member>) => {
    setBusyIds((ids) => new Set(ids).add(id));
    try {
      const query = patch ? supabase.from("members").update(patch) : supabase.from("members").delete();
      // Query builders are lazy: awaiting is what actually sends the write.
      const { data, error } = await query.eq("room_id", room.id).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Guest no longer found. Refresh and try again.");
      toast.success(patch?.approved ? "Guest approved" : patch ? "Mic permission updated" : "Guest removed");
      // Newly seated guest: let the agents look for common ground with everyone (once per approval).
      if (patch?.approved) void findSharedGround(room.id, id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update this guest. Try again.");
    } finally {
      setBusyIds((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">Waiting to join {pending.length > 0 && <span className="text-primary">({pending.length})</span>}</h3>
      {pending.length === 0 && <p className="text-sm text-muted-foreground">Nobody waiting.</p>}
      {pending.map((m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
          <Dot c={m.color} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-medium">{m.name}</p>
            <p className="text-xs uppercase text-muted-foreground">{m.language} · {m.role}</p>
          </div>
          <Button disabled={busyIds.has(m.id)} className="h-auto rounded-full px-4 py-2 font-semibold" onClick={() => void change(m.id, { approved: true })}>{busyIds.has(m.id) ? "Saving…" : "Approve"}</Button>
          <Button variant="outline" disabled={busyIds.has(m.id)} className="h-auto rounded-full px-3 py-2" onClick={() => void change(m.id)}>Remove</Button>
        </div>
      ))}
      <h3 className="mt-2 text-lg font-semibold">At the table</h3>
      {seated.map((m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
          <Dot c={m.color} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-medium">{m.name}{m.id === room.host_member_id && <span className="ml-2 text-xs text-primary">host</span>}</p>
            <p className="text-xs uppercase text-muted-foreground">{m.language} · {m.can_speak ? "can speak" : "muted"}</p>
          </div>
          {m.id !== room.host_member_id && (
            <>
              <Button variant="outline" disabled={busyIds.has(m.id)} className="h-auto rounded-full px-3 py-2 text-sm" onClick={() => void change(m.id, { can_speak: !m.can_speak })}>
                {m.can_speak ? "Mute" : "Allow mic"}
              </Button>
              <Button variant="outline" disabled={busyIds.has(m.id)} className="h-auto rounded-full px-3 py-2 text-sm" onClick={() => void change(m.id)}>Remove</Button>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

const Dot = ({ c }: { c: string }) => <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: c }} />;

/** Host-only switch for rooms.roast_mode: lets the agents tease people (kindly) about things said out loud. */
export function RoastToggle({ room }: { room: Room }) {
  const on = room.roast_mode === true;
  const [busy, setBusy] = useState(false);
  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl bg-secondary px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold">Roast mode</h3>
        <p className="text-sm text-muted-foreground">Let the agents tease the table about things said out loud. Always kind, never personal.</p>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label="Roast mode"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await supabase.from("rooms").update({ roast_mode: !on }).eq("id", room.id);
          setBusy(false);
          if (error) toast.error("Couldn't save roast mode");
          else toast.success(!on ? "Roast mode on — agents may tease the table" : "Roast mode off");
        }}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${on ? "bg-speaking" : "bg-muted"} disabled:opacity-60`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-foreground transition-all ${on ? "left-7" : "left-1"}`} aria-hidden />
      </button>
    </section>
  );
}
