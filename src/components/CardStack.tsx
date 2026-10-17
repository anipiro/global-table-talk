import { useRef, useState } from "react";
import { Lock, X } from "lucide-react";
import type { Card } from "@/lib/room";
import { renderBold } from "@/lib/richText";

/** One private card: slides in, dismisses on a sideways swipe or the close button. */
function SwipeCard({ card, big, onDismiss }: { card: Card; big: boolean; onDismiss: () => void }) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  return (
    <div
      role="status"
      onPointerDown={(e) => { start.current = e.clientX; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (start.current !== null) setDx(e.clientX - start.current); }}
      onPointerUp={() => { if (Math.abs(dx) > 80) onDismiss(); else setDx(0); start.current = null; }}
      onPointerCancel={() => { setDx(0); start.current = null; }}
      className={`animate-slide-down relative shrink-0 touch-pan-y select-none rounded-3xl bg-aubergine py-4 pl-5 pr-14 text-cream ${big ? "text-[20px]" : "text-[17px]"} transition-[transform,opacity]`}
      style={{
        transform: `translateX(${dx}px)`,
        opacity: Math.max(0.2, 1 - Math.abs(dx) / 240),
        transitionDuration: start.current === null ? "200ms" : "0ms",
      }}
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wide text-apricot"><Lock className="size-3.5" aria-hidden /> JUST FOR YOU</p>
      <p className="font-display text-[1.9em] leading-none">{card.title}</p>
      <p className="mt-2 whitespace-pre-wrap text-cream-2">{renderBold(card.body)}</p>
      <button
        aria-label="Dismiss"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onDismiss}
        className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-xl text-cream hover:bg-cream/15"
      >
        <X className="size-5" />
      </button>
    </div>
  );
}

/** Up to 3 private cards for me, newest on top. They sit in the page flow, so the feed shrinks instead of being covered. */
export function CardStack({ cards, onDismiss, big = false }: { cards: Card[]; onDismiss: (id: string) => void; big?: boolean }) {
  const top = [...cards].slice(-3).reverse();
  return (
    <>
      {top.map((c) => <SwipeCard key={c.id} card={c} big={big} onDismiss={() => onDismiss(c.id)} />)}
    </>
  );
}
