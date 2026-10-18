import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Share2, Sparkles } from "lucide-react";
import { toPng } from "html-to-image";
import { getMemberId } from "@/lib/room";
import { useRoom, useSignedUrls } from "@/lib/useRoom";
import { Screen } from "@/components/JoinForm";
import { Button, buttonVariants } from "@/components/ui/button";
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
      { name: "description", content: "The memory card of the night: the group photo, who was there, best moments and what you decided." },
      { property: "og:title", content: "Our night — Gamige" },
      { property: "og:description", content: "A memory card of the night, written by our agents." },
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
      <div ref={card} className="flex flex-col gap-5 rounded-lg border bg-card p-5">
        {painting ? (
          <figure className="overflow-hidden rounded-md bg-secondary">
            <img src={painting.url} crossOrigin="anonymous" alt={mediaCaption(painting, myLang) || "Tonight, painted"} className="aspect-[3/2] w-full object-cover" />
            <figcaption className="px-1 pb-1 pt-3">
              <p className="font-display text-[1.7rem] leading-none">{mediaCaption(painting, myLang)}</p>
              <p className="mt-1 text-xs text-muted-foreground">AI illustration</p>
            </figcaption>
          </figure>
        ) : (
          <div role="status" className="relative overflow-hidden rounded-md bg-secondary">
            <Shimmer className="aspect-[3/2] w-full rounded-none" />
            <p className="absolute inset-0 flex items-center justify-center gap-2 text-lg text-muted-foreground"><Sparkles className="size-5" aria-hidden /> Painting tonight…</p>
          </div>
        )}
        <div>
          <p className="text-base text-muted-foreground">Table {room?.code ?? code.toUpperCase()}</p>
          <h1 className="mt-1 text-4xl font-semibold">Tonight's story</h1>
        </div>
        {group ? (
          <div className="overflow-hidden rounded-md bg-secondary">
            {urls[group.storage_path] ? <img src={urls[group.storage_path]} crossOrigin="anonymous" alt="Group photo" className="w-full object-cover" /> : <Shimmer className="aspect-[4/3] w-full rounded-none" />}
          </div>
        ) : null}
        <ul className="flex flex-wrap gap-2" aria-label="Who was there">
          {guests.map((m) => (
            <li key={m.id} className="speaker-ink flex items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-lg font-semibold" style={{ "--speaker": m.color, borderColor: `color-mix(in oklab, ${m.color} 60%, var(--card))`, background: `color-mix(in oklab, ${m.color} 35%, var(--card))` } as React.CSSProperties}>
              {m.name}
              <BadgeRow badges={badges.get(m.id)} size={14} />
            </li>
          ))}
        </ul>

        {writing ? (
          <div role="status" className="rounded-md bg-secondary p-5">
            <p className="text-lg">Writing the recap…</p>
            <Shimmer className="mt-4 h-4 w-full" /><Shimmer className="mt-2 h-4 w-11/12" /><Shimmer className="mt-2 h-4 w-3/4" />
          </div>
        ) : (
          story.map((c) => <p key={c.id} lang={members.find((m) => m.id === meId)?.language} className="whitespace-pre-wrap font-text text-[20px]">{renderBold(c.body)}</p>)
        )}

        {moments.length > 0 && (
          <section>
            <h2 className="mb-2 text-xl font-semibold">Best moments</h2>
            <ul className="flex flex-col gap-2">
              {moments.map((n) => (
                <li key={n.id} className="rounded-md border p-3 text-lg">
                  <p className="font-semibold">{n.title}</p>
                  {n.body && <p className="text-muted-foreground">{n.body}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {decisions.length > 0 && (
          <section>
            <h2 className="mb-2 text-xl font-semibold">What we decided</h2>
            <ul className="flex flex-col gap-2">
              {decisions.map((n) => (
                <li key={n.id} className="rounded-md border p-3 text-lg">
                  <p className="font-semibold">{n.title}</p>
                  {n.body && <p className="text-muted-foreground">{n.body}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-center text-sm text-muted-foreground">Gamige</p>
      </div>

      <Button size="lg" onClick={share} disabled={saving || writing} className="mt-6">
        {typeof navigator !== "undefined" && "share" in navigator ? <Share2 aria-hidden /> : <Download aria-hidden />}
        {saving ? "Making the image…" : "Share the memory card"}
      </Button>
      <Link to="/" className={buttonVariants({ variant: "ghost", className: "mt-2 text-muted-foreground" })}>Home</Link>
    </Screen>
  );
}
