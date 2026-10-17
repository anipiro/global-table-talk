import { LANG_NAME, MODELS, type db } from "@/lib/ai.server";

/** Agent humour ("banter"). Called by the agent loop on lines where nothing else fired:
 *  occasionally one agent teases another agent or the situation, in character. Humans are teased only in
 *  roast mode, and only about things said out loud — the prompt never sees members.facts. */

type Supa = ReturnType<typeof db>;
type AskJson = <T>(request: Request, model: string, system: string, user: string) => Promise<T | null>;
type Member = { id: string; name: string; language: string; role: string };

const BANTER_COOLDOWN_MS = 90_000; // max once every 90 s per room
const LIVELY_WINDOW_MS = 60_000;
const LIVELY_LINES = 4; // only when 4+ lines were said in the last minute
const CHANCE = 0.35; // "occasionally": most lively lines still get no banter call
export const BANTER_PREFIX = "😄 ";

/** Each agent's voice, from its human's language and role. Stable, so an agent always sounds the same. */
const VOICE: Record<string, string> = {
  ka: "a proud Georgian tamada: grand, warm, speaks in toasts and big metaphors, never lets a glass stay empty",
  en: "dry and polite: British-style understatement, deadpan, impeccably courteous even when teasing",
  ru: "a deadpan philosopher: ironic, a touch melancholic, finds the cosmic absurdity in small things",
};
const ROLE: Record<string, string> = {
  talk: "chatty — loves the spotlight",
  follow: "the quiet observer who notices everything",
  both: "balanced — listens, then lands one good line",
};
export const persona = (m: Member) => `${VOICE[m.language] ?? VOICE["en"]}; ${ROLE[m.role] ?? ROLE["both"]}`;

// Hard bans, checked on the English version after the model's own check. Over-blocking is fine: if unsure, don't send.
// Whole words; a trailing * means "any word starting with".
const BANNED = new RegExp(
  `\\b(${[
    "fat", "skinny", "weight", "diet*", "ugly", "bald", "wrinkl*", "old", "older", "age", "aging", "young",
    "money", "rich", "poor", "broke", "salar*", "debt*", "sick", "ill", "health*", "doctor*", "disease*", "drunk*",
    "dating", "single", "divorc*", "wife", "husband", "girlfriend", "boyfriend", "marri*",
    "god", "church*", "pray*", "relig*", "priest*", "politic*", "president*", "government*", "putin", "war",
    "georgians", "russians", "americans", "brits", "british", "typical", "stereotyp*",
  ].map((w) => (w.endsWith("*") ? `${w.slice(0, -1)}\\w*` : w)).join("|")})\\b`,
  "i",
);

async function recentBanter(supa: Supa, roomId: string) {
  const since = new Date(Date.now() - BANTER_COOLDOWN_MS).toISOString();
  const { data } = await supa.from("agent_messages").select("from_member_id, created_at")
    .eq("room_id", roomId).eq("type", "note").like("content", `${BANTER_PREFIX}%`).gte("created_at", since).limit(1);
  return data?.[0] ?? null;
}

/** Whoever bantered last steps aside so the voices alternate. */
async function lastBanterer(supa: Supa, roomId: string) {
  const { data } = await supa.from("agent_messages").select("from_member_id")
    .eq("room_id", roomId).eq("type", "note").like("content", `${BANTER_PREFIX}%`)
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0]?.from_member_id ?? null;
}

export type BanterResult = "sent" | "quiet" | "cooldown" | "not lively" | "dice" | "blocked";

export async function maybeBanter(
  request: Request, supa: Supa, askJson: AskJson,
  o: { roomId: string; members: Member[]; context: string },
): Promise<BanterResult> {
  if (o.members.length < 2) return "quiet";
  // Free checks: lively room, room limit, then a dice roll — no AI on silence or quiet tables.
  const since = new Date(Date.now() - LIVELY_WINDOW_MS).toISOString();
  const { count } = await supa.from("lines").select("id", { count: "exact", head: true })
    .eq("room_id", o.roomId).gte("created_at", since);
  if ((count ?? 0) < LIVELY_LINES) return "not lively";
  if (await recentBanter(supa, o.roomId)) return "cooldown";
  if (Math.random() > CHANCE) return "dice";

  const { data: room } = await supa.from("rooms").select("*").eq("id", o.roomId).single();
  // Column added by the front; until it exists (or while false) humans are off-limits.
  const roast = (room as { roast_mode?: boolean } | null)?.roast_mode === true;

  const last = await lastBanterer(supa, o.roomId);
  const pool = o.members.filter((m) => m.id !== last);
  const me = pool[Math.floor(Math.random() * pool.length)] ?? o.members[0]!;
  const others = o.members.filter((m) => m.id !== me.id);

  // What the agents did lately: their own work is fair game.
  const { data: msgs } = await supa.from("agent_messages").select("from_member_id, type, content")
    // "answer" messages come from members.facts, which banter must never see.
    .eq("room_id", o.roomId).not("type", "in", "(bridge,answer)").order("created_at", { ascending: false }).limit(8);
  const nameOf = (id: string | null) => o.members.find((m) => m.id === id)?.name ?? "someone";
  const agentLog = (msgs ?? []).reverse().map((m) => `${nameOf(m.from_member_id)}'s agent (${m.type}): ${m.content}`).join("\n");

  // Room's main language: the one most members speak.
  const counts = new Map<string, number>();
  for (const m of o.members) counts.set(m.language, (counts.get(m.language) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const langs = [main, ...[...counts.keys()].filter((l) => l !== main)];

  const res = await askJson<{ send?: boolean; target?: string; en?: string; text?: Record<string, string> }>(request, MODELS.banter,
    `You are ${me.name}'s personal agent at a dinner table. Your voice: ${persona(me)}.
The other agents: ${others.map((m) => `${m.name}'s agent (${persona(m)})`).join("; ")}.
Write ONE short playful line (max 20 words) teasing ${roast ? "another agent, the situation, or — lightly and affectionately, like a friend at a supra — a person, but ONLY about something they said out loud in the lines below" : "another agent or the situation (the agents' own work, a topic that keeps coming back, a translation struggle). Do NOT tease any human"}.
Hard bans: appearance, weight, age, money, health, relationships, religion, politics, nationality stereotypes, anything private.
Be warm, never mean. If nothing is genuinely funny or you're unsure, set send=false.
JSON: {"send": true|false, "target": "who/what you tease", "en": "the line in English", "text": {${langs.map((l) => `"${l}": "the line in ${LANG_NAME[l]}"`).join(", ")}}}`,
    `Recent lines:\n${o.context}\n\nWhat the agents did lately:\n${agentLog || "(nothing yet)"}`);
  const words = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 20).join(" ");
  const en = words(res?.en);
  if (!res?.send || !en) return "quiet";
  const parts = langs.map((l) => words(res.text?.[l] ?? (l === "en" ? en : ""))).filter(Boolean);
  if (BANNED.test(en) || !parts.length) return "blocked";
  // Another line may have sent banter while we were writing.
  if (await recentBanter(supa, o.roomId)) return "cooldown";

  await supa.from("agent_messages").insert({
    room_id: o.roomId, from_member_id: me.id, type: "note", content: `${BANTER_PREFIX}${[...new Set(parts)].join(" · ")}`,
  });
  return "sent";
}
