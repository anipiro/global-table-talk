import { BookOpenText, Languages, Laugh, MessageCircle, Waypoints, type LucideIcon } from "lucide-react";
import type { AgentMessage, Card, Line, Media, Member, NotebookEntry } from "./room";

/** Table-life signals computed from room data (no extra queries): agent XP/levels, badges, harmony, connections. */

type PollLike = { created_by_member_id: string | null };

/* ---------- Agent levels ---------- */

export const XP = { notebook: 3, media: 2, card: 1, poll: 2, shared: 3 } as const;
export const LEVEL_AT = [0, 10, 25] as const; // level 1, 2, 3

export const levelFor = (xp: number) => (xp >= LEVEL_AT[2] ? 3 : xp >= LEVEL_AT[1] ? 2 : 1);

/** XP per member's agent: notebook entries owned ×3, media made ×2, cards delivered ×1, polls opened ×2, 🤝 links ×3. */
export function agentXp(d: {
  members: Member[]; notebook: NotebookEntry[]; media: Media[]; cards: Card[]; polls: PollLike[]; agentMessages: AgentMessage[];
}): Map<string, number> {
  const xp = new Map<string, number>(d.members.map((m) => [m.id, 0]));
  const add = (id: string | null | undefined, n: number) => { if (id && xp.has(id)) xp.set(id, xp.get(id)! + n); };
  for (const n of d.notebook) add(n.owner_member_id, XP.notebook);
  for (const m of d.media) add(m.created_by_member_id, XP.media);
  for (const c of d.cards) add(c.member_id, XP.card);
  for (const p of d.polls) add(p.created_by_member_id, XP.poll);
  for (const m of d.agentMessages) if (m.type === "note" && m.content.startsWith("🤝")) { add(m.from_member_id, XP.shared); add(m.to_member_id, XP.shared); }
  return xp;
}

/* ---------- Badges ---------- */

export const BADGE_PREFIX = "🏅";
export type BadgeKind = "first_words" | "storyteller" | "meme_maker" | "bridge" | "new_word";
export const BADGE_LABEL: Record<BadgeKind, string> = {
  first_words: "First words", storyteller: "Storyteller", meme_maker: "Meme maker", bridge: "Bridge", new_word: "New word",
};
export const BADGE_ICON: Record<BadgeKind, LucideIcon> = {
  first_words: MessageCircle, storyteller: BookOpenText, meme_maker: Laugh, bridge: Waypoints, new_word: Languages,
};
export type Badge = { id: string; kind: BadgeKind; text: string; memberId: string; at: number };

/** "🏅 first_words | Nika — first words at the table · …" → badge, or null for any other message. */
export function parseBadge(m: AgentMessage): Badge | null {
  const hit = /^🏅\s*([a-z_]+)\s*\|\s*([\s\S]*)$/.exec(m.content);
  if (!hit || !m.from_member_id || !(hit[1]! in BADGE_LABEL)) return null;
  return { id: m.id, kind: hit[1] as BadgeKind, text: hit[2]!.trim(), memberId: m.from_member_id, at: Date.parse(m.created_at) };
}

export function badgesByMember(msgs: AgentMessage[]): Map<string, Badge[]> {
  const by = new Map<string, Badge[]>();
  for (const m of msgs) {
    const b = parseBadge(m);
    if (b && !by.get(b.memberId)?.some((x) => x.kind === b.kind)) by.set(b.memberId, [...(by.get(b.memberId) ?? []), b]);
  }
  return by;
}

/* ---------- Harmony ---------- */

export const HARMONY_WINDOW_MS = 5 * 60_000;

/** How evenly the last 5 minutes were shared, 0..1 (normalized entropy of words spoken per member; silent members
 *  count as 0). Null until there's enough talk to judge (2+ members, 3+ lines in the window). */
export function harmony(lines: Line[], memberIds: string[], now = Date.now()): number | null {
  if (memberIds.length < 2) return null;
  const since = now - HARMONY_WINDOW_MS;
  const words = new Map<string, number>(memberIds.map((id) => [id, 0]));
  let n = 0;
  for (const l of lines) {
    if (!l.speaker_id || !words.has(l.speaker_id) || Date.parse(l.created_at) < since) continue;
    words.set(l.speaker_id, words.get(l.speaker_id)! + Math.max(1, l.text.trim().split(/\s+/).length));
    n++;
  }
  if (n < 3) return null;
  const total = [...words.values()].reduce((a, b) => a + b, 0);
  let h = 0;
  for (const w of words.values()) if (w > 0) { const p = w / total; h -= p * Math.log(p); }
  return h / Math.log(memberIds.length);
}

/* ---------- Connection web ---------- */

export type Link = { a: string; b: string; weight: number; lastAt: number };
const pair = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Who is connected to whom: replies within 10 s (+1), agent ask/answer between them (+1), a 🤝 note (+3). */
export function connections(lines: Line[], msgs: AgentMessage[]): Link[] {
  const links = new Map<string, Link>();
  const bump = (x: string | null, y: string | null, w: number, at: number) => {
    if (!x || !y || x === y) return;
    const k = pair(x, y);
    const l = links.get(k) ?? { a: x < y ? x : y, b: x < y ? y : x, weight: 0, lastAt: 0 };
    l.weight += w;
    l.lastAt = Math.max(l.lastAt, at);
    links.set(k, l);
  };
  const sorted = [...lines].sort((p, q) => Date.parse(p.created_at) - Date.parse(q.created_at));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!, cur = sorted[i]!;
    const at = Date.parse(cur.created_at);
    if (prev.speaker_id !== cur.speaker_id && at - Date.parse(prev.created_at) <= 10_000) bump(prev.speaker_id, cur.speaker_id, 1, at);
  }
  for (const m of msgs) {
    const at = Date.parse(m.created_at);
    if (m.type === "ask" || m.type === "answer") bump(m.from_member_id, m.to_member_id, 1, at);
    else if (m.type === "note" && m.content.startsWith("🤝")) bump(m.from_member_id, m.to_member_id, 3, at);
  }
  return [...links.values()];
}
