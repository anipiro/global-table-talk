import { LANG_NAME, MODELS, type db } from "@/lib/ai.server";

/** Agent polls. On a "decision" trigger that is still a proposal or question ("Kakheti on Sunday?"), the speaker's
 *  agent opens a 60 s poll in every room language. The front settles it (everyone voted or time's up) via
 *  task settle_poll; settling is idempotent and needs no AI: each option carries its own result text. */

type Supa = ReturnType<typeof db>;
type AskJson = <T>(request: Request, model: string, system: string, user: string) => Promise<T | null>;

const POLL_SECONDS = 60;
const STALE_MS = 30_000; // an open poll this far past closes_at was never settled (phones left) — settle it here
const NO_DECISION: Record<string, string> = { en: "No decision yet", ka: "გადაწყვეტილება ჯერ არ არის", ru: "Пока без решения" };

/** Matches the front's PollOption (`{ id, label_by_language }`); result_by_language is extra and ignored by the UI. */
type Option = { id: string; label_by_language: Record<string, string>; result_by_language: Record<string, string> };

export type PollResult = "opened" | "poll already open" | "no options";
export type SettleResult = "settled" | "no decision" | "already closed" | "still open" | "not found";

const pick = (m: unknown, lang: string) => {
  const x = (m ?? {}) as Record<string, string>;
  return x[lang] ?? x["en"] ?? Object.values(x)[0] ?? "";
};

export async function openPoll(
  request: Request, supa: Supa, askJson: AskJson,
  o: { roomId: string; lineId: string; line: string; creator: { id: string; name: string }; langs: string[]; context: string },
): Promise<PollResult> {
  // Max one open poll per room (settle a forgotten one first).
  const { data: open } = await supa.from("polls").select("id, closes_at").eq("room_id", o.roomId).eq("status", "open");
  for (const p of open ?? []) {
    if (new Date(p.closes_at).getTime() < Date.now() - STALE_MS) await settlePoll(supa, p.id);
    else return "poll already open";
  }

  const L = o.langs.map((l) => `"${l}": "... in ${LANG_NAME[l]}"`).join(", ");
  const res = await askJson<{ question?: Record<string, string>; options?: { label?: Record<string, string>; result?: Record<string, string> }[] }>(
    request, MODELS.trigger,
    `Someone at a dinner table proposed or asked about a plan. Turn it into a quick poll.
Question: max 6 words. Options: 2-4 — the alternatives that were mentioned, otherwise Yes / No. Labels: max 4 words.
For each option also write "result": the decision as a short statement if that option wins (max 8 words, e.g. "Kakheti on Sunday", "No Kakheti this Sunday").
Every text in every language: ${o.langs.map((l) => LANG_NAME[l]).join(", ")}.
JSON: {"question": {${L}}, "options": [{"label": {${L}}, "result": {${L}}}]}`,
    `Conversation:\n${o.context}\n\nThe proposal: ${o.line}`);
  const options: Option[] = (res?.options ?? []).slice(0, 4).map((x, i) => ({
    id: `o${i + 1}`,
    label_by_language: Object.fromEntries(o.langs.map((l) => [l, String(x.label?.[l] ?? "").trim()]).filter(([, v]) => v)),
    result_by_language: Object.fromEntries(o.langs.map((l) => [l, String(x.result?.[l] ?? "").trim()]).filter(([, v]) => v)),
  })).filter((x) => Object.keys(x.label_by_language).length);
  const question = Object.fromEntries(o.langs.map((l) => [l, String(res?.question?.[l] ?? "").trim()]).filter(([, v]) => v));
  if (options.length < 2 || !Object.keys(question).length) return "no options";

  // Another line may have opened a poll while the model was writing.
  const { count } = await supa.from("polls").select("id", { count: "exact", head: true }).eq("room_id", o.roomId).eq("status", "open");
  if (count) return "poll already open";

  await supa.from("polls").insert({
    room_id: o.roomId, line_id: o.lineId, created_by_member_id: o.creator.id, status: "open",
    question_by_language: question, options, closes_at: new Date(Date.now() + POLL_SECONDS * 1000).toISOString(),
  });
  await supa.from("agent_messages").insert({
    room_id: o.roomId, from_member_id: o.creator.id, type: "note", content: `${o.creator.name}'s agent opened a poll: ${pick(question, "en")}`,
  });
  return "opened";
}

/** Counts votes and closes the poll. Safe to call many times from many phones: only the first close wins. */
export async function settlePoll(supa: Supa, pollId: string): Promise<SettleResult> {
  const { data: poll } = await supa.from("polls").select().eq("id", pollId).maybeSingle();
  if (!poll) return "not found";
  if (poll.status !== "open") return "already closed";

  const [{ data: votes }, { data: members }] = await Promise.all([
    supa.from("poll_votes").select("member_id, option_id").eq("poll_id", pollId),
    supa.from("members").select("id, language").eq("room_id", poll.room_id).eq("approved", true),
  ]);
  const voted = new Set((votes ?? []).map((v) => v.member_id));
  const everyone = (members ?? []).length > 0 && (members ?? []).every((m) => voted.has(m.id));
  if (!everyone && new Date(poll.closes_at).getTime() > Date.now()) return "still open";

  const options = (Array.isArray(poll.options) ? poll.options : []) as unknown as Option[];
  const tally = new Map<string, number>();
  for (const v of votes ?? []) tally.set(v.option_id, (tally.get(v.option_id) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const winner = top && (ranked[1]?.[1] ?? 0) < top[1] ? options.find((x) => x.id === top[0]) : undefined;

  const langs = [...new Set([...(members ?? []).map((m) => m.language), ...Object.keys(poll.question_by_language as object)])];
  const result_text_by_language = Object.fromEntries(langs.map((l) => [
    l, winner ? pick(winner.result_by_language, l) || pick(winner.label_by_language, l) : NO_DECISION[l] ?? NO_DECISION["en"]!,
  ]));

  // Conditional close: if another phone settled first, this update matches nothing and we stop here.
  const { data: closed } = await supa.from("polls")
    .update({ status: "closed", result_option_id: winner?.id ?? null, result_text_by_language })
    .eq("id", pollId).eq("status", "open").select("id");
  if (!closed?.length) return "already closed";

  const question = pick(poll.question_by_language, "en");
  if (!winner) {
    await supa.from("agent_messages").insert({
      room_id: poll.room_id, from_member_id: poll.created_by_member_id, type: "note",
      content: `The agents counted the votes: no decision yet on “${question}”.`,
    });
    return "no decision";
  }
  const result = pick(result_text_by_language, "en");
  const n = votes?.length ?? 0;
  await supa.from("notebook").insert({
    room_id: poll.room_id, kind: "decision", owner_member_id: poll.created_by_member_id,
    title: result.split(/\s+/).slice(0, 8).join(" "),
    body: `Poll “${question}”: ${pick(winner.label_by_language, "en")} won with ${top![1]} of ${n} vote${n === 1 ? "" : "s"}.`,
  });
  await supa.from("agent_messages").insert({
    room_id: poll.room_id, from_member_id: poll.created_by_member_id, type: "note", content: `The agents settled it: ${result} 🎉`,
  });
  return "settled";
}
