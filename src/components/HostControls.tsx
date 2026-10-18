import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LANGS, ROLES, type Member, type Room } from "@/lib/room";
import { checkInvite, createInvite, inviteLink, revokeInvite, shareLink, type Invite } from "@/lib/invites";
import { fmtTime } from "@/lib/useRoom";
import { Button } from "@/components/ui/button";
import { findSharedGround } from "@/lib/agent";

const langName = (id: string) => LANGS.find((l) => l.id === id)?.label ?? id;
const roleName = (id: string) => ROLES.find((r) => r.id === id)?.label ?? id;

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-4xl leading-none">Invite links</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              const inv = await createInvite(room.id, me.id);
              const r = await shareLink(inviteLink(inv.token));
              toast.success(r === "copied" ? "Link copied. It works for 12 hours." : "Link shared");
            } catch {
              toast.error("Couldn't create a link");
            }
          }}
        >
          New link
        </Button>
      </div>
      {active.length === 0 && <p className="text-sm text-muted-foreground">No active links. Guests can still use the table code.</p>}
      {active.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-3 rounded-2xl border-[1.5px] bg-card px-4 py-3">
          <div className="min-w-0 flex-1 basis-40">
            <p className="truncate text-sm">…/i/{i.token.slice(0, 8)}</p>
            <p className="text-sm text-muted-foreground">Expires {fmtTime(i.expires_at)} · used {i.uses}×</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => shareLink(inviteLink(i.token)).then((r) => r === "copied" && toast.success("Copied"))}>
            Share
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => revokeInvite(i.id).then(() => toast("Link turned off"))}>
            Revoke
          </Button>
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
      <h2 className="text-4xl leading-none">Waiting to join {pending.length > 0 && <span className="text-redbrown">({pending.length})</span>}</h2>
      {pending.length === 0 && <p className="text-sm text-muted-foreground">Nobody waiting.</p>}
      {pending.map((m) => (
        <div key={m.id} className="rounded-2xl border-[1.5px] bg-card p-4">
          <div className="flex items-center gap-3">
            <Dot c={m.color} name={m.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[1.7rem] leading-none">{m.name}</p>
              <p className="mt-1 text-[15px] text-muted-foreground">{langName(m.language)} · {roleName(m.role)}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busyIds.has(m.id)} className="flex-1" onClick={() => void change(m.id, { approved: true })}>{busyIds.has(m.id) ? "Saving…" : "Approve"}</Button>
            <Button variant="outline" disabled={busyIds.has(m.id)} className="flex-1 text-destructive" onClick={() => void change(m.id)}>Remove</Button>
          </div>
        </div>
      ))}
      <h2 className="mt-4 text-4xl leading-none">At the table</h2>
      {seated.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-3 rounded-2xl border-[1.5px] bg-card px-4 py-3">
          <Dot c={m.color} name={m.name} />
          <div className="min-w-0 flex-1 basis-32">
            <p className="flex items-center gap-2.5 truncate font-display text-[1.7rem] leading-none">{m.name}{m.id === room.host_member_id && <span className="rounded-full bg-apricot px-2.5 py-0.5 font-sans text-xs font-bold tracking-wide text-foreground">host</span>}</p>
            <p className="mt-1 text-[15px] text-muted-foreground">{langName(m.language)} · {m.can_speak ? "can speak" : "muted"}</p>
          </div>
          {m.id !== room.host_member_id && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busyIds.has(m.id)} onClick={() => void change(m.id, { can_speak: !m.can_speak })}>
                {m.can_speak ? "Mute" : "Allow mic"}
              </Button>
              <Button variant="outline" size="sm" disabled={busyIds.has(m.id)} className="text-destructive" onClick={() => void change(m.id)}>Remove</Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/** A soft disc in the member's stored colour with their initial. Decorative: the name is next to it. */
const Dot = ({ c, name }: { c: string; name: string }) => (
  <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full text-lg font-extrabold leading-none text-foreground" style={{ background: `color-mix(in oklab, ${c} 85%, var(--background))` }}>
    {name.slice(0, 1).toUpperCase()}
  </span>
);

/** Host-only switch for rooms.roast_mode: lets the agents tease people (kindly) about things said out loud. */
export function RoastToggle({ room }: { room: Room }) {
  const on = room.roast_mode === true;
  const [busy, setBusy] = useState(false);
  return (
    <section className="flex items-center justify-between gap-4 rounded-2xl border-[1.5px] bg-card px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-[1.7rem] leading-none">Roast mode</h3>
        <p className="mt-1 text-sm text-muted-foreground">Let the agents tease the table about things said out loud. Always kind, never personal.</p>
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
        className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition-colors ${on ? "bg-primary" : "bg-input"} disabled:opacity-60`}
      >
        <span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-cream transition-transform ${on ? "translate-x-6" : ""}`} aria-hidden />
      </button>
    </section>
  );
}
