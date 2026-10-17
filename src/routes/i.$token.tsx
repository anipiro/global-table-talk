import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { joinRoom, getMemberId, type Member, type Room } from "@/lib/room";
import { deviceLabel } from "@/lib/agent";
import { checkInvite, INVITE_ERRORS, loadInvite, type Invite, type InviteCheck } from "@/lib/invites";
import { JoinForm, Screen, VoiceCalibration } from "@/components/JoinForm";

export const Route = createFileRoute("/i/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dinner invite — Gamige" },
      { name: "description", content: "You've been invited to a dinner table on Gamige." },
      { property: "og:title", content: "You're invited to dinner on Gamige" },
      { property: "og:description", content: "Join and follow the conversation in your own language." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InviteJoin,
});

function InviteJoin() {
  const { token } = Route.useParams();
  const nav = useNavigate();
  const [state, setState] = useState<{ invite: Invite | null; room: Room | null; check: InviteCheck } | null>(null);
  const [joined, setJoined] = useState<Member | null>(null);

  useEffect(() => {
    loadInvite(token).then(({ invite, room }) => {
      if (room && getMemberId(room.code)) {
        nav({ to: "/room/$code", params: { code: room.code }, replace: true });
        return;
      }
      setState({ invite, room, check: checkInvite(invite, room) });
    });
  }, [token, nav]);

  if (!state) return <Screen><p className="text-muted-foreground">Checking your invite…</p></Screen>;
  if (!state.check.ok)
    return (
      <Screen>
        <h1 className="text-3xl font-bold">Invite not valid</h1>
        <p className="mt-3 text-lg text-muted-foreground">{INVITE_ERRORS[state.check.reason]}</p>
        <Link to="/" className="mt-8 text-primary">Go home</Link>
      </Screen>
    );
  const { room, invite } = state;
  if (joined)
    return (
      <Screen>
        <VoiceCalibration
          name={joined.name}
          onDone={async (level) => {
            if (level)
              await supabase.from("members").update({ voice_level: level, voice_calibrated_at: new Date().toISOString(), voice_device: deviceLabel() }).eq("id", joined.id);
            nav({ to: "/room/$code", params: { code: room!.code } });
          }}
        />
      </Screen>
    );
  return (
    <Screen>
      <p className="text-sm uppercase tracking-[0.3em] text-primary">Table {room!.code}</p>
      <h1 className="mb-2 mt-1 text-4xl font-bold">You're invited</h1>
      <p className="mb-8 text-muted-foreground">The host will let you in once you join.</p>
      <JoinForm
        submitLabel="Ask to join"
        onSubmit={async (v) => {
          const again = await loadInvite(token);
          const c = checkInvite(again.invite, again.room);
          if (!c.ok) {
            toast.error(INVITE_ERRORS[c.reason]);
            setState({ ...again, check: c });
            return;
          }
          const m = await joinRoom(again.room!, v, invite!.id);
          setJoined(m);
        }}
      />
    </Screen>
  );
}
