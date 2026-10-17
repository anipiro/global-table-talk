import { LANG_NAME, MODELS, type db } from "@/lib/ai.server";
import { BANNED } from "./banter";

/** Shared Ground. On join (and once ~2 min after the room goes live) the agents compare their humans' facts and,
 *  when two people genuinely overlap, tell BOTH of them — only the overlap, never the rest of the other's facts.
 *  All candidate pairs go to the cheap model in one call. Max 1 per pair, max 2 per room. */

type Supa = ReturnType<typeof db>;
type AskJson = <T>(request: Request, model: string, system: string, user: string) => Promise<T | null>;
type Member = { id: string; name: string; language: string; role: string; facts: string };

const MAX_PER_ROOM = 2;
const MAX_PAIRS = 12; // keep the prompt small at big tables
export const SHARED_PREFIX = "🤝 ";

export type SharedResult = { found: number; skipped?: string };

export async function findSharedGround(
  request: Request, supa: Supa, askJson: AskJson, roomId: string, memberId?: string,
): Promise<SharedResult> {
  const { data: all } = await supa.from("members").select("id, name, language, role, facts, approved").eq("room_id", roomId);
  const members: Member[] = (all ?? []).filter((m) => m.approved && m.facts.trim());
  if (members.length < 2) return { found: 0, skipped: "need two members with facts" };

  const { data: notes } = await supa.from("agent_messages").select("from_member_id, to_member_id")
    .eq("room_id", roomId).eq("type", "note").like("content", `${SHARED_PREFIX}%`);
  const left = MAX_PER_ROOM - (notes?.length ?? 0);
  if (left <= 0) return { found: 0, skipped: "room already has common ground" };
  const done = new Set((notes ?? []).map((n) => [n.from_member_id, n.to_member_id].sort().join()));

  // Candidate pairs: with the new member only on join; all pairs on the later pass. Best bridges first.
  const pairs: [Member, Member][] = [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const a = members[i]!, b = members[j]!;
    if (memberId && a.id !== memberId && b.id !== memberId) continue;
    if (done.has([a.id, b.id].sort().join())) continue;
    pairs.push([a, b]);
  }
  const bridge = ([a, b]: [Member, Member]) => (a.language !== b.language ? 2 : 0) + (a.role === "follow" || b.role === "follow" ? 1 : 0);
  pairs.sort((x, y) => bridge(y) - bridge(x));
  const todo = pairs.slice(0, MAX_PAIRS);
  if (!todo.length) return { found: 0, skipped: "no new pairs" };

  const label = new Map(members.map((m, i) => [m.id, `P${i + 1}`]));
  const res = await askJson<{ overlaps?: { pair?: string; topic?: string; cards?: Record<string, string> }[] }>(request, MODELS.trigger,
    `You help guests at a dinner table find common ground. Each person typed a few facts about themselves.
For each listed pair, report an overlap ONLY if it is genuine and specific: same country or city lived in, same sport or team,
hobby, profession, or a place both visited. Vague similarities ("both like food", "both are friendly") do not count.
Never use health, money, relationships, religion or politics.
For each overlap write one card per person, in THAT person's language, max 20 words: name the other person, mention ONLY the
shared thing, and suggest something to ask (e.g. "You and Anna both love football — ask her about her team!").
Never reveal any other fact about the other person.
JSON: {"overlaps": [{"pair": "P1-P2", "topic": "the shared thing in max 4 English words", "cards": {"P1": "...", "P2": "..."}}]}  (empty list if none)`,
    `People:\n${members.map((m) => `${label.get(m.id)} ${m.name} (writes in ${LANG_NAME[m.language]}): ${m.facts}`).join("\n")}
\nPairs to check: ${todo.map(([a, b]) => `${label.get(a.id)}-${label.get(b.id)}`).join(", ")}`);

  let found = 0;
  for (const [a, b] of todo) {
    if (found >= left) break;
    const la = label.get(a.id)!, lb = label.get(b.id)!;
    const o = (res?.overlaps ?? []).find((x) => x.pair === `${la}-${lb}` || x.pair === `${lb}-${la}`);
    const topic = String(o?.topic ?? "").trim().split(/\s+/).slice(0, 4).join(" ");
    const ca = String(o?.cards?.[la] ?? "").trim(), cb = String(o?.cards?.[lb] ?? "").trim();
    if (!topic || !ca || !cb || BANNED.test(topic)) continue;

    // Another join may have filled the room meanwhile.
    const { count } = await supa.from("agent_messages").select("id", { count: "exact", head: true })
      .eq("room_id", roomId).eq("type", "note").like("content", `${SHARED_PREFIX}%`);
    if ((count ?? 0) >= MAX_PER_ROOM) break;

    // Title holds both names so the card shows the two linked avatars.
    const title = `${a.name} & ${b.name}`;
    await supa.from("cards").insert([
      { room_id: roomId, member_id: a.id, kind: "shared", title, body: ca },
      { room_id: roomId, member_id: b.id, kind: "shared", title, body: cb },
    ]);
    await supa.from("agent_messages").insert({
      room_id: roomId, from_member_id: a.id, to_member_id: b.id, type: "note",
      content: `${SHARED_PREFIX}${a.name}'s agent and ${b.name}'s agent found common ground: ${topic}`,
    });
    found++;
  }
  return { found };
}
