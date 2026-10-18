import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Users } from "lucide-react";
import { Avatar, agentName } from "@/components/AgentFeed";
import { voiceLevel, watchVoiceLevels } from "@/lib/agent";
import type { AgentMessage, Card, Line, Media, Member, NotebookEntry } from "@/lib/room";
import {
  agentXp, BADGE_ICON, BADGE_LABEL, badgesByMember, connections, harmony, levelFor, parseBadge, type Badge, type BadgeKind,
} from "@/lib/tableLife";

/** Table-life UI: voice ripples, agent level orbs, badges, harmony ring, connection web.
 *  Animations use transform/opacity only; ripples bypass React (one rAF loop writes styles directly). */

/* ---------- Voice ripples ---------- */

const ripples = new Map<HTMLElement, { id: string; ref: number; v: number }>();
let raf = 0;
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function tick() {
  const still = reduceMotion();
  for (const [el, r] of ripples) {
    const target = Math.min(1, voiceLevel(r.id) / r.ref);
    const v = target > r.v ? r.v + (target - r.v) * 0.6 : r.v * 0.86; // fast attack, soft release
    if (v < 0.01 && r.v < 0.01) continue; // silent: no style writes
    r.v = v < 0.01 ? 0 : v;
    el.style.opacity = String(Math.min(0.85, r.v * 1.3));
    el.style.transform = still ? "none" : `scale(${1 + r.v * 0.5})`;
  }
  raf = ripples.size ? requestAnimationFrame(tick) : 0;
}

/** The editorial "talking" ring (brown, flat), driven live by the member's mic level from the room's level broadcast. */
export function VoiceRipple({ member }: { member: Member }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // Calibrated speaking level when we have it, so a quiet voice still fills the ring.
    ripples.set(node, { id: member.id, ref: Math.max(0.02, member.voice_level ?? 0.06), v: 0 });
    if (!raf) raf = requestAnimationFrame(tick);
    return () => { ripples.delete(node); };
  }, [member.id, member.voice_level]);
  return (
    <span ref={el} aria-hidden className="voice-ripple pointer-events-none absolute -inset-1 rounded-full border-2 border-brown" style={{ opacity: 0 }} />
  );
}

/** Keeps the room's mic-level channel open while a screen shows ripples. */
export function useVoiceLevels(roomId: string | undefined) {
  useEffect(() => (roomId ? watchVoiceLevels(roomId) : undefined), [roomId]);
}

/* ---------- Avatar with ripple, level orb and badge pop ---------- */

export function TableAvatar({ member, size, level, pop }: { member: Member; size: number; level?: number | undefined; pop?: BadgeKind | undefined }) {
  const Icon = pop ? BADGE_ICON[pop] : null;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <VoiceRipple member={member} />
      <Avatar member={member} size={size} level={level} />
      {Icon && (
        <span key={pop} aria-hidden
          className="animate-badge-pop pointer-events-none absolute left-1/2 top-0 z-10 flex items-center justify-center rounded-full border-2 border-background bg-apricot text-foreground"
          style={{ width: Math.max(22, size * 0.6), height: Math.max(22, size * 0.6) }}>
          <Icon style={{ width: "60%", height: "60%" }} />
        </span>
      )}
    </span>
  );
}

/** Small badge icons (under a name on the presenter view and the recap card). */
export function BadgeRow({ badges, size = 16 }: { badges: Badge[] | undefined; size?: number }) {
  if (!badges?.length) return null;
  return (
    <span className="flex items-center justify-center gap-1 text-foreground" aria-label={`Badges: ${badges.map((b) => BADGE_LABEL[b.kind]).join(", ")}`}>
      {badges.map((b) => {
        const Icon = BADGE_ICON[b.kind];
        return <span key={b.kind} title={BADGE_LABEL[b.kind]} className="rounded-full bg-apricot p-1"><Icon style={{ width: size, height: size }} aria-hidden /></span>;
      })}
    </span>
  );
}

/* ---------- Harmony ring ---------- */

export function HarmonyRing({ value, size, celebrate, showLabel = false }: { value: number | null; size: number; celebrate?: boolean; showLabel?: boolean }) {
  const stroke = Math.max(3, size * 0.07);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null ? null : Math.round(value * 100);
  const color = "var(--brown)";
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}
      role="img" aria-label={pct === null ? "Harmony: waiting for more conversation" : `Harmony ${pct}%: how evenly the last 5 minutes were shared`}>
      {celebrate && <span aria-hidden className="animate-harmony-glow absolute inset-0 rounded-full border-[3px] border-apricot" />}
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - (value ?? 0))} style={{ transition: "stroke-dashoffset 1.2s ease, stroke .6s" }} />
      </svg>
      {showLabel && (
        <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display leading-none tabular-nums" style={{ fontSize: size * 0.26 }}>{pct === null ? "—" : `${pct}%`}</span>
          <span className="mt-1 font-semibold text-muted-foreground" style={{ fontSize: Math.max(11, size * 0.075) }}>
            {celebrate ? "Everyone's in" : "Harmony"}
          </span>
        </span>
      )}
    </span>
  );
}

/** "Everyone's in" chip for the phone top bar. */
export function EveryonesIn() {
  return (
    <span role="status" className="animate-msg-in flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-apricot px-2.5 py-0.5 text-xs font-bold text-foreground">
      <Users className="size-3" aria-hidden /> Everyone's in
    </span>
  );
}

/* ---------- Light confetti (first words only) ---------- */

const CONFETTI = ["var(--terracotta)", "var(--apricot)", "var(--brown)", "var(--spk-blue)", "var(--spk-sage)", "var(--spk-mauve)"];

/** A light burst in the palette's colours (first words only). `colors` can add the members' colours to the mix. */
export function Confetti({ colors = [] }: { colors?: string[] }) {
  const pieces = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    left: 30 + Math.random() * 40, dx: (Math.random() - 0.5) * 50, rot: (Math.random() - 0.5) * 720,
    delay: Math.random() * 0.25, color: [...CONFETTI, ...colors][i % (CONFETTI.length + colors.length)]!, round: i % 3 === 0,
  })), [colors]);
  if (reduceMotion()) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p, i) => (
        <span key={i} className={`confetti-piece absolute top-0 h-2.5 ${p.round ? "w-2.5 rounded-full" : "w-1.5 rounded-sm"}`}
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, ["--dx" as string]: `${p.dx}vw`, ["--rot" as string]: `${p.rot}deg` }} />
      ))}
    </div>
  );
}

/* ---------- The hook: levels, badges, harmony, celebrations ---------- */

const CELEBRATE_EVERY_MS = 5 * 60_000;

export function useTableLife(d: {
  roomId: string | undefined; status: string; meId?: string | null | undefined;
  members: Member[]; lines: Line[]; agentMessages: AgentMessage[]; notebook: NotebookEntry[]; media: Media[]; cards: Card[];
  polls: { created_by_member_id: string | null }[];
}) {
  const approved = useMemo(() => d.members.filter((m) => m.approved), [d.members]);
  const byId = useMemo(() => new Map(d.members.map((m) => [m.id, m])), [d.members]);

  const xp = useMemo(() => agentXp({ members: approved, notebook: d.notebook, media: d.media, cards: d.cards, polls: d.polls, agentMessages: d.agentMessages }),
    [approved, d.notebook, d.media, d.cards, d.polls, d.agentMessages]);
  const levels = useMemo(() => new Map([...xp].map(([id, x]) => [id, levelFor(x)])), [xp]);
  const badges = useMemo(() => badgesByMember(d.agentMessages), [d.agentMessages]);
  const links = useMemo(() => connections(d.lines, d.agentMessages), [d.lines, d.agentMessages]);

  // Harmony looks at the last 5 minutes, so it also has to move while nobody speaks.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);
  const ids = useMemo(() => approved.map((m) => m.id), [approved]);
  const harmonyValue = useMemo(() => harmony(d.lines, ids, now), [d.lines, ids, now]);

  const ready = d.status !== "loading";
  const meId = d.meId;

  // Level-ups: toast + orb pop (the orb replays its animation when its level key changes).
  const seenLevels = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!seenLevels.current) { seenLevels.current = new Map(levels); return; }
    for (const [id, lvl] of levels) {
      const before = seenLevels.current.get(id) ?? 1;
      if (lvl > before) toast(`${agentName(byId.get(id), meId)} reached level ${lvl}`, { icon: <Sparkles className="h-4 w-4 text-primary" /> });
      seenLevels.current.set(id, lvl);
    }
  }, [levels, ready, byId, meId]);

  // New badges: toast, a pop on the member's avatar for a few seconds, confetti for first words.
  const seenBadges = useRef<Set<string> | null>(null);
  const [pops, setPops] = useState<Map<string, BadgeKind>>(new Map());
  const [confetti, setConfetti] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const all = d.agentMessages.map(parseBadge).filter((b): b is Badge => !!b);
    if (!seenBadges.current) { seenBadges.current = new Set(all.map((b) => b.id)); return; }
    const fresh = all.filter((b) => !seenBadges.current!.has(b.id));
    if (!fresh.length) return;
    for (const b of fresh) {
      seenBadges.current.add(b.id);
      const who = byId.get(b.memberId);
      const Icon = BADGE_ICON[b.kind];
      toast(`${who?.id === meId ? "You" : who?.name ?? "Someone"} earned a badge: ${BADGE_LABEL[b.kind]}`,
        { description: b.text.split(" · ")[0], icon: <Icon className="h-4 w-4 text-primary" /> });
    }
    setPops((p) => { const n = new Map(p); for (const b of fresh) n.set(b.memberId, b.kind); return n; });
    const t1 = setTimeout(() => setPops((p) => { const n = new Map(p); for (const b of fresh) if (n.get(b.memberId) === b.kind) n.delete(b.memberId); return n; }), 3400);
    let t2: ReturnType<typeof setTimeout> | undefined;
    if (fresh.some((b) => b.kind === "first_words")) { setConfetti(true); t2 = setTimeout(() => setConfetti(false), 2000); }
    return () => { clearTimeout(t1); if (t2) clearTimeout(t2); };
  }, [d.agentMessages, ready, byId, meId]);

  // "Everyone's in": harmony at 90%+, at most once per 5 minutes on this screen.
  const lastCelebrated = useRef(0);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!ready || harmonyValue === null || harmonyValue < 0.9 || Date.now() - lastCelebrated.current < CELEBRATE_EVERY_MS) return;
    lastCelebrated.current = Date.now();
    setCelebrate(true);
    const t = setTimeout(() => setCelebrate(false), 4500);
    return () => clearTimeout(t);
  }, [harmonyValue, ready]);

  return { approved, levels, xp, badges, links, harmony: harmonyValue, celebrate, pops, confetti };
}

/* ---------- Connection web (presenter) ---------- */

export function ConnectionWeb({ members, life }: { members: Member[]; life: ReturnType<typeof useTableLife> }) {
  const n = members.length;
  const pos = new Map(members.map((m, i) => {
    const a = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2;
    return [m.id, n === 1 ? { x: 50, y: 50 } : { x: 50 + 38 * Math.cos(a), y: 50 + 38 * Math.sin(a) }];
  }));
  const now = Date.now();
  const node = n > 6 ? 56 : 72;
  // Links that would cross the harmony ring in the middle bend around it (quadratic curve away from center).
  const CLEAR = 20; // viewBox units kept free around the center
  const path = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dist = Math.hypot(mx - 50, my - 50);
    if (dist >= CLEAR) return `M${a.x} ${a.y} L${b.x} ${b.y}`;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let px = -(b.y - a.y) / len, py = (b.x - a.x) / len; // unit normal
    if ((mx - 50) * px + (my - 50) * py < 0) { px = -px; py = -py; } // point away from center
    const bend = (CLEAR - dist) * 2 + 4; // curve apex sits at ~CLEAR + 2 from center
    return `M${a.x} ${a.y} Q${mx + px * bend} ${my + py * bend} ${b.x} ${b.y}`;
  };
  return (
    <div className="relative mx-auto aspect-square h-full max-h-full max-w-full">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        {life.links.map((l) => {
          const a = pos.get(l.a), b = pos.get(l.b);
          if (!a || !b) return null;
          const ca = members.find((m) => m.id === l.a)?.color ?? "var(--brown)";
          const cb = members.find((m) => m.id === l.b)?.color ?? "var(--brown)";
          // Flat: the two members' colours blended, pulled toward the ink so the line reads on the card.
          const stroke = `color-mix(in oklab, color-mix(in oklab, ${ca} 50%, ${cb}) 45%, var(--foreground))`;
          const s = Math.sqrt(l.weight);
          const width = 0.6 + Math.min(1.8, s * 0.35);
          const opacity = 0.3 + Math.min(0.65, s * 0.14);
          const fresh = now - l.lastAt < 10_000;
          return (
            <path key={`${l.a}${l.b}-${fresh ? l.lastAt : "s"}`} d={path(a, b)} fill="none" strokeLinecap="round" strokeWidth={width}
              className={fresh ? "animate-link-flash" : undefined} style={{ stroke, opacity, ["--o" as string]: opacity }} />
          );
        })}
      </svg>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <HarmonyRing value={life.harmony} size={Math.round(node * 2.2)} celebrate={life.celebrate} showLabel />
      </div>
      {members.map((m) => {
        const p = pos.get(m.id)!;
        return (
          <div key={m.id} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <TableAvatar member={m} size={node} level={life.levels.get(m.id)} pop={life.pops.get(m.id)} />
            {/* A card-coloured backing so a link passing under the name never cuts through it. */}
            <span className="flex flex-col items-center gap-1 rounded-2xl bg-card px-2 py-0.5">
              <span className="speaker-ink max-w-[9rem] truncate text-lg font-semibold" style={{ "--speaker": m.color } as React.CSSProperties}>{m.name}</span>
              <BadgeRow badges={life.badges.get(m.id)} size={14} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
