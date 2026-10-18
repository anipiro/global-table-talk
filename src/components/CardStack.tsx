import { useRef, useState } from "react";
import { Lightbulb, Lock, Rewind, Star, Users, X } from "lucide-react";
import type { Card, Member } from "@/lib/room";
import { renderBold } from "@/lib/richText";

/** The small apricot label on each private card: what kind of help it is. */
const LABEL = {
  context: { Icon: Lock, text: "JUST FOR YOU" },
  catchup: { Icon: Rewind, text: "CATCH-UP" },
  recap: { Icon: Star, text: "YOUR NIGHT" },
  shared: { Icon: Users, text: "COMMON GROUND" },
} as const;

/** Find up to two members whose names appear in the card text (for the shared-ground link). */
function sharedPair(card: Card, members: Member[]): Member[] {
  const hay = `${card.title} ${card.body}`.toLowerCase();
  return members.filter((m) => m.approved && hay.includes(m.name.toLowerCase())).slice(0, 2);
}

/** Two soft member discs joined by an apricot line — the "shared ground" marker. Flat, decorative. */
function SharedLink({ pair }: { pair: Member[] }) {
  if (!pair.length) return null;
  return (
    <span className="flex items-center" aria-hidden>
      {pair.map((m, i) => (
        <span key={m.id} className="flex items-center">
          {i > 0 && <span className="mx-1 h-[3px] w-6 rounded-full bg-apricot" />}
          <span className="grid size-8 place-items-center rounded-full text-sm font-extrabold leading-none text-foreground"
            style={{ background: `color-mix(in oklab, ${m.color} 85%, var(--background))` }}>
            {m.name.slice(0, 1).toUpperCase()}
          </span>
        </span>
      ))}
    </span>
  );
}

/** One private card: slides in, dismisses on a sideways swipe or the close button. */
function SwipeCard({ card, big, members, onDismiss }: { card: Card; big: boolean; members: Member[]; onDismiss: () => void }) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const { Icon, text } = LABEL[card.kind as keyof typeof LABEL] ?? { Icon: Lightbulb, text: "JUST FOR YOU" };
  const pair = card.kind === "shared" ? sharedPair(card, members) : [];
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
      <p className="mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wide text-apricot"><Icon className="size-3.5" aria-hidden /> {text}</p>
      {pair.length > 0 && <div className="mb-2 mt-1"><SharedLink pair={pair} /></div>}
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
export function CardStack({ cards, onDismiss, big = false, members = [] }: { cards: Card[]; onDismiss: (id: string) => void; big?: boolean; members?: Member[] }) {
  const top = [...cards].slice(-3).reverse();
  return (
    <>
      {top.map((c) => <SwipeCard key={c.id} card={c} big={big} members={members} onDismiss={() => onDismiss(c.id)} />)}
    </>
  );
}
