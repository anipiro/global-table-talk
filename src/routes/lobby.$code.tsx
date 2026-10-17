import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { getMemberId } from "@/lib/room";
import { useRoom, useWakeLock } from "@/lib/useRoom";
import { GuestList, InvitePanel } from "@/components/HostControls";
import { Screen } from "@/components/JoinForm";

export const Route = createFileRoute("/lobby/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your table lobby — Gamige" },
      { name: "description", content: "Let guests scan in, approve them, and start the night." },
      { property: "og:title", content: "Table lobby — Gamige" },
      { property: "og:description", content: "Invite guests to your Gamige table." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Lobby,
});

function Lobby() {
  const { code } = Route.useParams();
  const nav = useNavigate();
  const { room, members } = useRoom(code);
  const meId = getMemberId(code);
  const me = members.find((m) => m.id === meId);
  useWakeLock(true);

  useEffect(() => {
    if (room && (room.host_member_id !== meId || room.status !== "lobby")) nav({ to: "/room/$code", params: { code }, replace: true });
  }, [room, meId, code, nav]);

  if (!room || !me) return <Screen><p className="text-muted-foreground">Loading…</p></Screen>;
  const url = `${window.location.origin}/t/${room.code}`;
  return (
    <Screen>
      <p className="text-center text-sm uppercase tracking-[0.3em] text-muted-foreground">Scan to join</p>
      <div className="mx-auto mt-4 rounded-3xl bg-foreground p-5">
        <QRCodeSVG value={url} size={240} bgColor="transparent" fgColor="currentColor" className="text-background" />
      </div>
      <p className="mt-6 text-center font-display text-7xl font-bold tracking-[0.25em] text-primary">{room.code}</p>
      <p className="text-center text-sm text-muted-foreground">or go to {window.location.host}/join</p>
      <div className="mt-8 flex flex-col gap-8">
        <GuestList room={room} members={members} />
        <InvitePanel room={room} me={me} />
      </div>
      <button
        onClick={async () => {
          await supabase.from("rooms").update({ status: "live" }).eq("id", room.id);
          nav({ to: "/room/$code", params: { code } });
        }}
        className="sticky bottom-4 mt-10 rounded-full bg-primary py-5 text-2xl font-semibold text-primary-foreground shadow-lg"
      >
        Start
      </button>
    </Screen>
  );
}
