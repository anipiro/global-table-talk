import { useEffect } from "react";
import { Maximize2, X } from "lucide-react";
import type { Media, Member } from "@/lib/room";

/** Caption in the viewer's language, falling back to English then any language. */
export function mediaCaption(m: Media, lang: string): string {
  const caps = (m.caption_by_language ?? {}) as Record<string, string>;
  return caps[lang] ?? caps["en"] ?? Object.values(caps)[0] ?? "";
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
    <figure className={`overflow-hidden rounded-2xl bg-card ${large ? "" : "max-w-sm"}`}>
      <div className="relative">
        <img src={media.url} alt={caption || media.query} className="w-full object-contain" loading="lazy" />
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
          {media.credit && <p className="mt-0.5 text-xs text-muted-foreground">{media.credit}</p>}
        </figcaption>
      )}
    </figure>
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
        <p className="text-base text-muted-foreground">Found by <span className="font-semibold" style={{ color: by?.color }}>{by ? `${by.name}'s agent` : "an agent"}</span></p>
        <button onClick={onClose} aria-label="Close picture" className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary"><X /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-2" onClick={onClose}>
        <MediaCard media={media} lang={lang} large />
      </div>
      {media.kind !== "meme" && (caption || media.credit) && (
        <div className="px-5 py-4">
          {caption && <p className="text-[1.1em] font-semibold">{caption}</p>}
          {media.credit && <p className="mt-1 text-xs text-muted-foreground">{media.credit}</p>}
        </div>
      )}
    </div>
  );
}
