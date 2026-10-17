import type { db } from "@/lib/ai.server";

/** Badges: once per member per room, stored as agent notes "🏅 <kind> | <text>". No new tables, no AI calls —
 *  the text comes from fixed templates in every room language (most-spoken first, others after " · "),
 *  the same layout banter uses. The note is "from" the member's own agent. */

type Supa = ReturnType<typeof db>;
type Member = { id: string; name: string; language: string; role: string };

export const BADGE_PREFIX = "🏅 ";
export type BadgeKind = "first_words" | "storyteller" | "meme_maker" | "bridge" | "new_word";

// Names stay in the nominative ("Nika — …") so Georgian and Russian need no case endings.
const TEXT: Record<BadgeKind, Record<string, (n: string, x: string) => string>> = {
  first_words: {
    en: (n) => `${n} — first words at the table`,
    ka: (n) => `${n} — პირველი სიტყვები მაგიდასთან`,
    ru: (n) => `${n} — первые слова за столом`,
  },
  storyteller: {
    en: (n) => `${n} — storyteller: their words made the notebook`,
    ka: (n) => `${n} — მთხრობელი: მისი სიტყვები ბლოკნოტში მოხვდა`,
    ru: (n) => `${n} — рассказчик: их слова попали в блокнот`,
  },
  meme_maker: {
    en: (n) => `${n} — meme maker: a joke that crossed languages`,
    ka: (n) => `${n} — მემების ოსტატი: ხუმრობამ ენები გადალახა`,
    ru: (n) => `${n} — мемодел: шутка перешла языковой барьер`,
  },
  bridge: {
    en: (n, x) => `${n} — bridge: brought ${x} into the conversation`,
    ka: (n, x) => `${n} — ხიდი: ${x} საუბარში ჩაერთო`,
    ru: (n, x) => `${n} — мост: ${x} теперь в разговоре`,
  },
  new_word: {
    en: (n, x) => `${n} — new word: “${x}”`,
    ka: (n, x) => `${n} — ახალი სიტყვა: „${x}“`,
    ru: (n, x) => `${n} — новое слово: «${x}»`,
  },
};

/** Room languages, most-spoken first. */
function roomLangs(members: Member[]) {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.language, (counts.get(m.language) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

/** Awards a badge unless this member already has it. Returns true when a new badge was written. */
export async function award(supa: Supa, roomId: string, member: Member, members: Member[], kind: BadgeKind, extra = "") {
  const { count } = await supa.from("agent_messages").select("id", { count: "exact", head: true })
    .eq("room_id", roomId).eq("from_member_id", member.id).eq("type", "note").like("content", `${BADGE_PREFIX}${kind} |%`);
  if (count) return false;
  const parts = roomLangs(members).map((l) => (TEXT[kind][l] ?? TEXT[kind]["en"]!)(member.name, extra));
  await supa.from("agent_messages").insert({
    room_id: roomId, from_member_id: member.id, type: "note", content: `${BADGE_PREFIX}${kind} | ${[...new Set(parts)].join(" · ")}`,
  });
  return true;
}

/** A member whose language fewer people at the table speak than some other language. */
const isMinority = (m: Member, members: Member[]) => {
  const counts = new Map<string, number>();
  for (const x of members) counts.set(x.language, (counts.get(x.language) ?? 0) + 1);
  return (counts.get(m.language) ?? 0) < Math.max(...counts.values());
};

/** first_words: the first line from a "follow" member or a minority-language speaker. Free: one small query. */
export async function firstWords(supa: Supa, roomId: string, lineId: string, speaker: Member, members: Member[]) {
  if (speaker.role !== "follow" && !isMinority(speaker, members)) return false;
  const { data } = await supa.from("lines").select("id").eq("room_id", roomId).eq("speaker_id", speaker.id)
    .order("created_at", { ascending: true }).limit(1);
  if (data?.[0]?.id !== lineId) return false; // not their first line
  return award(supa, roomId, speaker, members, "first_words");
}

/** The approved member (not the speaker) with the fewest lines in the last 5 minutes — who a "bridge" question reaches. */
export async function quietest(supa: Supa, roomId: string, speakerId: string, members: Member[]) {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data } = await supa.from("lines").select("speaker_id").eq("room_id", roomId).gte("created_at", since);
  const n = new Map<string, number>();
  for (const l of data ?? []) if (l.speaker_id) n.set(l.speaker_id, (n.get(l.speaker_id) ?? 0) + 1);
  return members.filter((m) => m.id !== speakerId).sort((a, b) => (n.get(a.id) ?? 0) - (n.get(b.id) ?? 0))[0] ?? null;
}
