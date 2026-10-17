import { useEffect } from "react";
import { X } from "lucide-react";
import type { Member, Photo, PhotoCaption } from "@/lib/room";
import { useSignedUrls } from "@/lib/useRoom";

export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} aria-hidden />;
}

/** Grid of shared photos; captions shimmer until the agents' description arrives. */
export function PhotoGrid({ photos, captions, lang, onOpen }: {
  photos: Photo[]; captions: PhotoCaption[]; lang: string; onOpen: (id: string) => void;
}) {
  const urls = useSignedUrls(photos.map((p) => p.storage_path));
  if (!photos.length)
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        <p className="text-lg text-foreground">No photos yet 📷</p>
        <p>Snap the khachapuri, the toast, the view — your agents will describe it for everyone in their language.</p>
      </div>
    );
  return (
    <ul className="grid grid-cols-2 gap-3 pt-2">
      {[...photos].reverse().map((p) => {
        const c = captions.find((x) => x.photo_id === p.id && x.language === lang) ?? captions.find((x) => x.photo_id === p.id);
        return (
          <li key={p.id}>
            <button onClick={() => onOpen(p.id)} className="block w-full overflow-hidden rounded-2xl bg-secondary text-left" aria-label={c?.caption ? `Open photo: ${c.caption}` : "Open photo"}>
              {urls[p.storage_path] ? <img src={urls[p.storage_path]} alt={c?.caption ?? "Shared photo"} className="aspect-square w-full object-cover" /> : <Shimmer className="aspect-square w-full rounded-none" />}
              <div className="p-2 text-[0.85em]">
                {c ? <p className="line-clamp-2 font-semibold">{c.caption}</p> : <><Shimmer className="mb-1 h-3.5 w-4/5" /><Shimmer className="h-3 w-1/2" /></>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Fullscreen photo with caption + description in my language and who shared it. */
export function PhotoViewer({ photo, captions, lang, byId, onClose }: {
  photo: Photo; captions: PhotoCaption[]; lang: string; byId: Map<string, Member>; onClose: () => void;
}) {
  const urls = useSignedUrls([photo.storage_path]);
  const c = captions.find((x) => x.photo_id === photo.id && x.language === lang) ?? captions.find((x) => x.photo_id === photo.id);
  const by = byId.get(photo.uploader_id ?? "");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo" className="fixed inset-0 z-50 flex flex-col bg-background pb-safe pt-safe">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-base text-muted-foreground">Shared by <span className="font-semibold" style={{ color: by?.color }}>{by?.name ?? "someone"}</span></p>
        <button onClick={onClose} aria-label="Close photo" className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary"><X /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-2" onClick={onClose}>
        {urls[photo.storage_path] ? <img src={urls[photo.storage_path]} alt={c?.caption ?? "Shared photo"} className="max-h-full max-w-full rounded-2xl object-contain" /> : <Shimmer className="aspect-[4/3] w-full" />}
      </div>
      <div className="px-5 py-4">
        {c ? (
          <>
            <p className="text-[1.1em] font-semibold">{c.caption}</p>
            <p className="mt-1 text-muted-foreground">{c.description}</p>
          </>
        ) : (
          <div aria-label="Your agents are describing this photo"><Shimmer className="mb-2 h-5 w-3/4" /><Shimmer className="h-4 w-full" /></div>
        )}
      </div>
    </div>
  );
}
