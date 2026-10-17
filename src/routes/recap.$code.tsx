import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { getMemberId } from "@/lib/room";
import { useRoom, useSignedUrls } from "@/lib/useRoom";
import { Screen } from "@/components/JoinForm";

export const Route = createFileRoute("/recap/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your night — Gamige recap" },
      { name: "description", content: "A recap of tonight's dinner, written by your agent." },
      { property: "og:title", content: "Our night — Gamige" },
      { property: "og:description", content: "A recap of the dinner." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Recap,
});

function Recap() {
  const { code } = Route.useParams();
  const { room, members, photos, cards } = useRoom(code);
  const meId = getMemberId(code);
  const group = [...photos].reverse().find((p) => p.storage_path.includes("/group-"));
  const urls = useSignedUrls(group ? [group.storage_path] : []);
  const mine = cards.filter((c) => c.kind === "recap" && c.member_id === meId);

  async function share() {
    const text = `Our night at table ${room?.code}: ${members.map((m) => m.name).join(", ")}\n\n${mine.map((c) => c.body).join("\n\n")}`;
    try {
      if (navigator.share) await navigator.share({ title: "Our night — Gamige", text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success("Recap copied");
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <Screen>
      <p className="text-sm uppercase tracking-[0.3em] text-primary">The night of table {room?.code}</p>
      <h1 className="mt-1 text-5xl font-bold">Your night</h1>
      {group && (
        <div className="mt-6 overflow-hidden rounded-3xl bg-card">
          {urls[group.storage_path] ? <img src={urls[group.storage_path]} alt="Group photo" className="w-full object-cover" /> : <div className="aspect-[4/3]" />}
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {members.filter((m) => m.approved).map((m) => (
          <span key={m.id} className="rounded-full border px-4 py-1.5 text-lg" style={{ color: m.color, borderColor: m.color }}>{m.name}</span>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3">
        {mine.length === 0 && <p className="rounded-3xl bg-card p-5 text-lg text-muted-foreground">Your agent is writing your recap…</p>}
        {mine.map((c) => (
          <article key={c.id} className="rounded-3xl bg-card p-5">
            <h2 className="mb-2 text-xl font-semibold text-primary">{c.title}</h2>
            <p className="whitespace-pre-wrap text-[20px] leading-relaxed">{c.body}</p>
          </article>
        ))}
      </div>
      <button onClick={share} className="mt-8 rounded-full bg-primary py-5 text-xl font-semibold text-primary-foreground">Share</button>
      <Link to="/" className="mt-4 text-center text-muted-foreground">Home</Link>
    </Screen>
  );
}
