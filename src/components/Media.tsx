import { useEffect } from "react";
import { Maximize2, X } from "lucide-react";
import type { Media, Member } from "@/lib/room";

export function isTonightMedia(media: Media): boolean {
  return media.kind === "reference_image" && media.query === "tonight";
}

export function newestTonightMedia(media: Media[]): Media | undefined {
  return media.filter(isTonightMedia).reduce<Media | undefined>((newest, item) =>
    !newest || item.created_at > newest.created_at ? item : newest, undefined);
}

/** Caption in the viewer's language, falling back to English then any language. */
export function mediaCaption(m: Media, lang: string): string {
  const caps = (m.caption_by_language ?? {}) as Record<string, string>;
  return caps[lang] ?? caps["en"] ?? Object.values(caps)[0] ?? "";
}

/** Pictures tied to the line that triggered them, keyed by line id — this is what the live feed renders inline.
 *  A picture with no triggering line stays out of the feed (it still shows in the notebook). */
export function mediaByLine(media: Media[]): Map<string, Media[]> {
  const by = new Map<string, Media[]>();
  for (const m of media) if (m.line_id) by.set(m.line_id, [...(by.get(m.line_id) ?? []), m]);
  return by;
}

/**
 * Renders one media item: a reference image card (image, caption, credit)
 * or a meme (template image with bold outlined top/bottom text).
 * Pass onOpen to make the picture tappable (opens the fullscreen viewer).
 */
export function MediaCard({ media, lang, large = false, onOpen }: {
  media: Media; lang: string; large?: boolean; onOpen?: () => void;
}) {
  const caption = mediaCaption(media, lang);
  const isMeme = media.kind === "meme";
  return (
    <figure className={`overflow-hidden rounded-lg bg-card ${large ? "" : "max-w-sm"}`}>
      <div className="relative">
        <img src={media.url} alt={caption || media.query} loading="lazy"
          className={`w-full ${isMeme ? "max-h-[70dvh] object-contain" : large ? "max-h-[70dvh] object-contain" : "aspect-[4/3] object-cover"} rounded-2xl`} />
        {isMeme && (
          <>
            <p className="meme-text absolute inset-x-2 top-2 text-center">{caption.split("\n")[0] ?? media.query}</p>
            <p className="meme-text absolute inset-x-2 bottom-2 text-center">{caption.split("\n").slice(1).join(" ")}</p>
          </>
        )}
        {onOpen && (
          <>
            <button onClick={onOpen} aria-label={caption ? `Open larger: ${caption}` : "Open picture larger"}
              className="absolute inset-0 cursor-zoom-in rounded-2xl focus-visible:ring-2 focus-visible:ring-ring" />
            <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white" aria-hidden>
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          </>
        )}
      </div>
      {!isMeme && (caption || media.credit) && (
        <figcaption className="p-3">
          {caption && <p className={large ? "text-2xl font-semibold" : "font-semibold"}>{caption}</p>}
          {media.credit && <p className="mt-0.5 text-sm text-muted-foreground">{media.credit}</p>}
        </figcaption>
      )}
    </figure>
  );
}

/** "From the agents" grid for the Photos tab: every picture and meme the agents made, newest first. */
export function AgentMediaSection({ media, lang, onOpen }: {
  media: Media[]; lang: string; onOpen: (id: string) => void;
}) {
  if (!media.length) return null;
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-[1.9rem] leading-none">From the agents</h3>
      <ul className="flex flex-col gap-3">
        {[...media].reverse().map((m) => (
          <li key={m.id}>
            <MediaCard media={m} lang={lang} onOpen={() => onOpen(m.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Fullscreen picture an agent found: big image, caption in my language, credit, and whose agent found it. */
export function MediaViewer({ media, lang, by, onClose }: {
  media: Media; lang: string; by?: Member | undefined; onClose: () => void;
}) {
  const caption = mediaCaption(media, lang);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={caption || media.query} className="fixed inset-0 z-50 flex flex-col bg-background pb-safe pt-safe">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-base text-muted-foreground">Found by <span className="speaker-ink font-semibold" style={{ "--speaker": by?.color } as React.CSSProperties}>{by ? `${by.name}'s agent` : "an agent"}</span></p>
        <button onClick={onClose} aria-label="Close picture" className="flex size-11 items-center justify-center rounded-xl border-2 border-input bg-card"><X /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-2" onClick={onClose}>
        <MediaCard media={media} lang={lang} large />
      </div>
      {/* the card under the picture already carries the caption and credit */}
    </div>
  );
}

