import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { getMemberId } from "@/lib/room";
import { useRoom, useWakeLock } from "@/lib/useRoom";
import { GuestList, InvitePanel } from "@/components/HostControls";
import { Screen } from "@/components/JoinForm";
import { Button } from "@/components/ui/button";

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
  const tiles = [
    { bg: "var(--code-1)", fg: "var(--cream)" },
    { bg: "var(--code-2)", fg: "var(--foreground)" },
    { bg: "var(--code-3)", fg: "var(--cream)" },
    { bg: "var(--code-4)", fg: "var(--foreground)" },
  ];
  return (
    <main className="screen-in mx-auto grid w-full max-w-[1080px] gap-8 px-5 pb-[max(env(safe-area-inset-bottom),2rem)] pt-[max(env(safe-area-inset-top),1.5rem)] min-[900px]:grid-cols-2 min-[900px]:items-start min-[900px]:gap-16 min-[900px]:px-14 min-[900px]:pt-10">
      {/* The QR is the focal point and the table code sits huge and plain under it. */}
      <section>
        <h1 className="rise mb-4 text-center font-sans text-base font-semibold tracking-normal text-muted-foreground" style={{ "--i": 0 } as React.CSSProperties}>
          Scan to join
        </h1>
        <div className="rise relative mx-auto w-[min(300px,74vw)]" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="absolute inset-0 translate-x-3.5 translate-y-3.5 rounded-3xl bg-apricot" aria-hidden="true" />
          <div className="relative rounded-3xl border-2 border-input bg-card p-5 text-foreground">
            <QRCodeSVG value={url} bgColor="transparent" fgColor="currentColor" className="block h-auto w-full" size={240} role="img" aria-label="QR code to join this table" />
          </div>
        </div>
        <div className="mb-2.5 mt-11 flex justify-center gap-2" role="img" aria-label={`Table code ${room.code.split("").join(" ")}`}>
          {room.code.split("").map((ch, i) => (
            <b
              key={i}
              aria-hidden="true"
              className="code-tile grid aspect-[0.82] w-[clamp(62px,19vw,92px)] place-items-center rounded-[20px] font-display text-[clamp(54px,16vw,80px)] font-normal leading-none"
              style={{ background: tiles[i % tiles.length]!.bg, color: tiles[i % tiles.length]!.fg, "--j": i } as React.CSSProperties}
            >
              {ch}
            </b>
          ))}
        </div>
        <p className="rise text-center text-base text-muted-foreground" style={{ "--i": 5 } as React.CSSProperties}>
          or go to {window.location.host}/join
        </p>
      </section>
      <section className="flex flex-col gap-9">
        <GuestList room={room} members={members} />
        <InvitePanel room={room} me={me} />
        <div className="sticky bottom-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-4">
          <Button
            size="lg"
            className="w-full"
            onClick={async () => {
              await supabase.from("rooms").update({ status: "live" }).eq("id", room.id);
              nav({ to: "/room/$code", params: { code } });
            }}
          >
            Start
          </Button>
        </div>
      </section>
    </main>
  );
}
