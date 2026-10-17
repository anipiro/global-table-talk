import { useRef, useState } from "react";
import { Lightbulb, Rewind, Star, Users, X } from "lucide-react";
import type { Card, Member } from "@/lib/room";
import { renderBold } from "@/lib/richText";

const ICON = { context: Lightbulb, catchup: Rewind, recap: Star, shared: Users } as const;

/** Find up to two members whose names appear in the card text (for the shared-ground link). */
function sharedPair(card: Card, members: Member[]): Member[] {
  const hay = `${card.title} ${card.body}`.toLowerCase();
  return members.filter((m) => m.approved && hay.includes(m.name.toLowerCase())).slice(0, 2);
}

/** Two member avatars joined by a glowing link — the "shared ground" marker. */
function SharedLink({ pair }: { pair: Member[] }) {
  if (!pair.length) return null;
  return (
    <span className="flex items-center" aria-hidden>
      {pair.map((m, i) => (
        <span key={m.id} className="flex items-center">
          {i > 0 && <span className="mx-0.5 h-0.5 w-5 animate-pulse rounded-full bg-primary shadow-[0_0_8px_2px] shadow-primary/60" />}
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-primary-foreground ring-2 ring-primary/50" style={{ background: m.color }}>
            {m.name.slice(0, 1).toUpperCase()}
          </span>
        </span>
      ))}
    </span>
  );
}

/** One private card: slides in, dismisses on a sideways swipe or the close button. */
function SwipeCard({ card, depth, big, members, onDismiss }: { card: Card; depth: number; big: boolean; members: Member[]; onDismiss: () => void }) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const Icon = ICON[card.kind as keyof typeof ICON] ?? Lightbulb;
  const shared = card.kind === "shared";
  const pair = shared ? sharedPair(card, members) : [];
  return (
    <div
      role="status"
      onPointerDown={(e) => { start.current = e.clientX; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (start.current !== null) setDx(e.clientX - start.current); }}
      onPointerUp={() => { if (Math.abs(dx) > 80) onDismiss(); else setDx(0); start.current = null; }}
      onPointerCancel={() => { setDx(0); start.current = null; }}
      className={`animate-slide-down pointer-events-auto relative touch-pan-y select-none rounded-3xl border bg-card p-4 pr-12 shadow-xl ${shared ? "border-primary/60 shadow-primary/20" : ""} ${big ? "text-[20px]" : "text-[17px]"} transition-[transform,opacity]`}
      style={{
        transform: `translateX(${dx}px) scale(${1 - depth * 0.03})`,
        opacity: Math.max(0.2, 1 - Math.abs(dx) / 240) * (1 - depth * 0.12),
        transitionDuration: start.current === null ? "200ms" : "0ms",
      }}
    >
      <p className={`mb-1 flex items-center gap-2 text-sm font-semibold ${shared ? "text-online" : "text-primary"}`}>
        <Icon className="h-4 w-4" aria-hidden /> {card.title}
      </p>
      {shared && <div className="mb-2"><SharedLink pair={pair} /></div>}
      <p className="whitespace-pre-wrap">{renderBold(card.body)}</p>
      <button aria-label="Dismiss" onPointerDown={(e) => e.stopPropagation()} onClick={onDismiss} className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Up to 3 private cards for me, newest on top. */
export function CardStack({ cards, onDismiss, big = false, members = [] }: { cards: Card[]; onDismiss: (id: string) => void; big?: boolean; members?: Member[] }) {
  const top = [...cards].slice(-3).reverse();
  return (
    <>
      {top.map((c, i) => <SwipeCard key={c.id} card={c} depth={i} big={big} members={members} onDismiss={() => onDismiss(c.id)} />)}
    </>
  );
}
