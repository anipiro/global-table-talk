import { useRef, useState } from "react";
import { Lightbulb, Rewind, Star, X } from "lucide-react";
import type { Card } from "@/lib/room";

const ICON = { context: Lightbulb, catchup: Rewind, recap: Star } as const;

/** One private card: slides in, dismisses on a sideways swipe or the close button. */
function SwipeCard({ card, depth, big, onDismiss }: { card: Card; depth: number; big: boolean; onDismiss: () => void }) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const Icon = ICON[card.kind as keyof typeof ICON] ?? Lightbulb;
  return (
    <div
      role="status"
      onPointerDown={(e) => { start.current = e.clientX; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (start.current !== null) setDx(e.clientX - start.current); }}
      onPointerUp={() => { if (Math.abs(dx) > 80) onDismiss(); else setDx(0); start.current = null; }}
      onPointerCancel={() => { setDx(0); start.current = null; }}
      className={`animate-slide-down pointer-events-auto relative touch-pan-y select-none rounded-3xl border bg-card p-4 pr-12 shadow-xl ${big ? "text-[20px]" : "text-[17px]"} transition-[transform,opacity]`}
      style={{
        transform: `translateX(${dx}px) scale(${1 - depth * 0.03})`,
        opacity: Math.max(0.2, 1 - Math.abs(dx) / 240) * (1 - depth * 0.12),
        transitionDuration: start.current === null ? "200ms" : "0ms",
      }}
    >
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-primary">
        <Icon className="h-4 w-4" aria-hidden /> {card.title}
      </p>
      <p className="whitespace-pre-wrap">{card.body}</p>
      <button aria-label="Dismiss" onPointerDown={(e) => e.stopPropagation()} onClick={onDismiss} className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Up to 3 private cards for me, newest on top. */
export function CardStack({ cards, onDismiss, big = false }: { cards: Card[]; onDismiss: (id: string) => void; big?: boolean }) {
  const top = [...cards].slice(-3).reverse();
  return (
    <>
      {top.map((c, i) => <SwipeCard key={c.id} card={c} depth={i} big={big} onDismiss={() => onDismiss(c.id)} />)}
    </>
  );
}
