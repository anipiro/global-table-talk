import type { Media } from "@/lib/room";

/** Caption in the viewer's language, falling back to English then any language. */
export function mediaCaption(m: Media, lang: string): string {
  const caps = (m.caption_by_language ?? {}) as Record<string, string>;
  return caps[lang] ?? caps["en"] ?? Object.values(caps)[0] ?? "";
}

/**
 * Renders one media item: a reference image card (image, caption, credit)
 * or a meme (template image with bold outlined top/bottom text).
 */
export function MediaCard({ media, lang, large = false }: { media: Media; lang: string; large?: boolean }) {
  const caption = mediaCaption(media, lang);
  const isMeme = media.kind === "meme";
  return (
    <figure className={`overflow-hidden rounded-lg bg-card ${large ? "" : "max-w-sm"}`}>
      <div className="relative">
        <img src={media.url} alt={caption || media.query} className="w-full object-contain" loading="lazy" />
        {isMeme && (
          <>
            <p className="meme-text absolute inset-x-2 top-2 text-center">{caption.split("\n")[0] ?? media.query}</p>
            <p className="meme-text absolute inset-x-2 bottom-2 text-center">{caption.split("\n").slice(1).join(" ")}</p>
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
