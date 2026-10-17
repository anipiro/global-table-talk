import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getMemberId, getRoomByCode, joinRoom, type Room } from "@/lib/room";
import { JoinForm, Screen } from "@/components/JoinForm";

export const Route = createFileRoute("/t/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "You're invited to a table — Gamige" },
      { name: "description", content: "Join this dinner table on Gamige and follow along in your language." },
      { property: "og:title", content: "Join my table on Gamige" },
      { property: "og:description", content: "Follow the dinner conversation in your own language." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinTable,
});

function JoinTable() {
  const { code } = Route.useParams();
  const nav = useNavigate();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const r = await getRoomByCode(code);
      setRoom(r);
      const mid = getMemberId(code);
      if (r && mid) {
        const { data: m } = await supabase.from("members").select("id").eq("id", mid).maybeSingle();
        if (m) nav({ to: r.host_member_id === mid && r.status === "lobby" ? "/lobby/$code" : "/room/$code", params: { code: r.code }, replace: true });
      }
    })();
  }, [code, nav]);

  if (room === undefined) return <Screen><p className="text-muted-foreground">Finding the table…</p></Screen>;
  if (!room)
    return (
      <Screen>
        <h1 className="text-3xl font-bold">No table "{code.toUpperCase()}"</h1>
        <Link to="/join" className="mt-6 text-primary">Try another code</Link>
      </Screen>
    );
  if (room.status === "ended")
    return <Screen><h1 className="text-3xl font-bold">This dinner has ended.</h1></Screen>;
  const isHost = !room.host_member_id;
  return (
    <Screen>
      <Link to="/" className="text-muted-foreground">← Home</Link>
      <p className="mt-6 text-sm uppercase tracking-[0.3em] text-primary">Table {room.code}</p>
      <h1 className="mb-8 mt-1 text-4xl font-bold">{isHost ? "You're the host" : "Pull up a chair"}</h1>
      <JoinForm
        submitLabel={isHost ? "Open the table" : "Join"}
        onSubmit={async (v) => {
          try {
            await joinRoom(room, v);
            nav({ to: isHost ? "/lobby/$code" : "/room/$code", params: { code: room.code } });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Couldn't join");
          }
        }}
      />
    </Screen>
  );
}
