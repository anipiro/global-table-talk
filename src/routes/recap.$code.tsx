import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Share2, Sparkles, Star } from "lucide-react";
import { toPng } from "html-to-image";
import { getMemberId } from "@/lib/room";
import { useRoom, useSignedUrls } from "@/lib/useRoom";
import { Screen } from "@/components/JoinForm";
import { Shimmer } from "@/components/Photos";
import { isGroupPhoto } from "@/lib/photos";
import { renderBold } from "@/lib/richText";
import { mediaCaption, newestTonightMedia } from "@/components/Media";
import { BadgeRow } from "@/components/TableLife";
import { badgesByMember } from "@/lib/tableLife";

export const Route = createFileRoute("/recap/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Tonight's story — Gamige recap" },
      { name: "description", content: "The memory card of tonight's dinner: the group photo, who was there, best moments and what you decided." },
      { property: "og:title", content: "Our night — Gamige" },
      { property: "og:description", content: "A memory card of the dinner, written by our agents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Recap,
});

function Recap() {
  const { code } = Route.useParams();
  const { room, members, photos, cards, notebook, media, agentMessages, status } = useRoom(code);
  const badges = useMemo(() => badgesByMember(agentMessages), [agentMessages]);
  const meId = getMemberId(code);
  const myLang = members.find((m) => m.id === meId)?.language ?? "en";
  const painting = newestTonightMedia(media);
  const group = [...photos].reverse().find((p) => isGroupPhoto(p.storage_path));
  const urls = useSignedUrls(group ? [group.storage_path] : []);
  const story = cards.filter((c) => c.kind === "recap" && c.member_id === meId);
  const moments = notebook.filter((n) => n.kind === "moment");
  const decisions = notebook.filter((n) => n.kind === "decision");
  const guests = members.filter((m) => m.approved);
  const card = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const writing = story.length === 0;
  void status;

  async function share() {
    if (!card.current) return;
    setSaving(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const url = await toPng(card.current, { pixelRatio: 2, cacheBust: true, backgroundColor: bg });
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], `gamige-${room?.code ?? code}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Our night — Gamige" });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        toast.success("Memory card saved as an image");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast.error("Couldn't make the image. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <div ref={card} className="flex flex-col gap-5 rounded-[2rem] bg-card p-5">
        {painting ? (
          <figure className="overflow-hidden rounded-3xl bg-secondary">
            <img src={painting.url} crossOrigin="anonymous" alt={mediaCaption(painting, myLang) || "Tonight, painted"} className="aspect-[3/2] w-full object-cover" />
            <figcaption className="p-3">
              <p className="text-lg font-semibold">{mediaCaption(painting, myLang)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">AI illustration</p>
            </figcaption>
          </figure>
        ) : (
          <div role="status" className="relative overflow-hidden rounded-3xl bg-secondary">
            <Shimmer className="aspect-[3/2] w-full rounded-none" />
            <p className="absolute inset-0 flex items-center justify-center gap-2 text-lg text-muted-foreground"><Sparkles className="h-5 w-5" /> Painting tonight…</p>
          </div>
        )}
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-primary">Table {room?.code ?? code.toUpperCase()}</p>
          <h1 className="mt-1 text-4xl font-bold">Tonight's story</h1>
        </div>
        {group ? (
          <div className="overflow-hidden rounded-3xl bg-secondary">
            {urls[group.storage_path] ? <img src={urls[group.storage_path]} crossOrigin="anonymous" alt="Group photo" className="w-full object-cover" /> : <Shimmer className="aspect-[4/3] w-full rounded-none" />}
          </div>
        ) : null}
        <ul className="flex flex-wrap gap-2" aria-label="Who was there">
          {guests.map((m) => (
            <li key={m.id} className="flex flex-col items-center gap-1 rounded-2xl border px-4 py-1.5 text-lg font-semibold" style={{ color: m.color, borderColor: m.color }}>
              {m.name}
              <BadgeRow badges={badges.get(m.id)} size={14} />
            </li>
          ))}
        </ul>

        {writing ? (
          <div role="status" className="rounded-3xl bg-secondary p-5">
            <p className="flex items-center gap-2 text-lg text-primary"><Sparkles className="h-5 w-5 animate-pulse" /> Your agents are writing tonight's story…</p>
            <Shimmer className="mt-4 h-4 w-full" /><Shimmer className="mt-2 h-4 w-11/12" /><Shimmer className="mt-2 h-4 w-3/4" />
          </div>
        ) : (
          story.map((c) => <p key={c.id} className="whitespace-pre-wrap text-[20px] leading-relaxed">{renderBold(c.body)}</p>)
        )}

        <section>
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold"><Star className="h-5 w-5 text-primary" /> Best moments</h2>
          {moments.length ? (
            <ul className="flex flex-col gap-2">
              {moments.map((n) => <li key={n.id} className="rounded-2xl bg-secondary p-3 text-lg"><b>{n.title}</b>{n.body ? ` — ${n.body}` : ""}</li>)}
            </ul>
          ) : <p className="text-muted-foreground">The best moments live in the story above.</p>}
        </section>
        <section>
          <h2 className="mb-2 text-xl font-semibold">What we decided</h2>
          {decisions.length ? (
            <ul className="flex flex-col gap-2">
              {decisions.map((n) => <li key={n.id} className="rounded-2xl bg-secondary p-3 text-lg"><b>{n.title}</b>{n.body ? ` — ${n.body}` : ""}</li>)}
            </ul>
          ) : <p className="text-muted-foreground">No plans made tonight — just good company.</p>}
        </section>
        <p className="text-center text-sm text-muted-foreground">Gamige · understand me</p>
      </div>

      <button onClick={share} disabled={saving || writing} className="mt-6 flex min-h-14 items-center justify-center gap-2 rounded-full bg-primary py-4 text-xl font-semibold text-primary-foreground disabled:opacity-60">
        {typeof navigator !== "undefined" && "share" in navigator ? <Share2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        {saving ? "Making the image…" : "Share the memory card"}
      </button>
      <Link to="/" className="mt-4 min-h-11 py-2 text-center text-muted-foreground">Home</Link>
    </Screen>
  );
}
