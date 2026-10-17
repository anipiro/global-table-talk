import { LANG_NAME, MODELS, type db } from "@/lib/ai.server";

/** Feature 3 — joke translator memes. Called by the agent loop on the `joke` trigger:
 *  the speaker's agent explains what's funny, the listener's agent remakes it as a meme for their culture.
 *  Free checks first (reuse by line, one meme per room per minute), then two short agent calls. */

type Supa = ReturnType<typeof db>;
type AskJson = <T>(request: Request, model: string, system: string, user: string) => Promise<T | null>;
type Who = { id: string; name: string; language: string };
type Template = { id: string; name: string; url: string };

const MEME_COOLDOWN_MS = 60_000; // max one meme per room per minute
const TEMPLATE_TTL_MS = 6 * 60 * 60_000;
const USER_AGENT = "Gamige/0.1 (hackathon dinner-table translation app; joke memes for guests)";
// Keep it kind: no politicians, no templates built on mocking someone.
const UNKIND = /bernie|trump|biden|putin|obama|politic|mocking|slapping|disaster girl/i;
const KINDNESS = "Keep it kind: never mock anyone at the table; no politics, religion, or jokes about appearance.";

export type MemeResult = "added" | "reused" | "cooldown" | "unkind" | "no explanation" | "no template" | "no text";

let templates: { at: number; list: Template[] } | null = null;

/** Imgflip's public top-100 templates (no auth), two-box ones only, cached in memory for a few hours. */
async function getTemplates(signal: AbortSignal): Promise<Template[]> {
  if (templates && Date.now() - templates.at < TEMPLATE_TTL_MS) return templates.list;
  try {
    const res = await fetch("https://api.imgflip.com/get_memes", { headers: { "User-Agent": USER_AGENT }, signal });
    const d = (await res.json()) as { success?: boolean; data?: { memes?: (Template & { box_count: number })[] } };
    const list = (d.data?.memes ?? []).filter((m) => m.box_count === 2 && !UNKIND.test(m.name))
      .map(({ id, name, url }) => ({ id, name, url }));
    if (list.length) templates = { at: Date.now(), list };
  } catch (e) {
    console.error("imgflip error", e);
  }
  return templates?.list ?? [];
}

async function inCooldown(supa: Supa, roomId: string) {
  const since = new Date(Date.now() - MEME_COOLDOWN_MS).toISOString();
  const { count } = await supa.from("media").select("id", { count: "exact", head: true })
    .eq("room_id", roomId).eq("kind", "meme").gte("created_at", since);
  return (count ?? 0) > 0;
}

/** One line of meme text: no line breaks (the front splits top/bottom on "\n"), max ~10 words. */
const memeLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 10).join(" ");

export async function addMeme(
  request: Request, supa: Supa, askJson: AskJson,
  o: { roomId: string; lineId: string; joke: string; speaker: Who & { facts: string }; listener: Who; langs: string[]; context: string },
): Promise<MemeResult> {
  // Free checks: this line was already memed, then the room limit.
  const { data: same } = await supa.from("media").select("id").eq("room_id", o.roomId).eq("kind", "meme").eq("line_id", o.lineId).limit(1);
  if (same?.length) return "reused";
  if (await inCooldown(supa, o.roomId)) return "cooldown";

  // 1. Speaker's agent: what's funny and why, in one line.
  const ex = await askJson<{ kind?: boolean; gist?: string; explanation?: string }>(request, MODELS.agent,
    `You are ${o.speaker.name}'s personal agent at a dinner table. ${o.speaker.name} just made a joke that may not survive translation.
${KINDNESS} If the joke breaks that rule, set kind=false.
JSON: {"kind": true|false, "gist": "the joke's idea in max 6 English words", "explanation": "max 25 words, English, to ${o.listener.name}'s agent: what's funny and why"}`,
    `Conversation:\n${o.context}\n\nThe joke (by ${o.speaker.name}): ${o.joke}`);
  if (ex?.kind === false) return "unkind";
  const gist = memeLine(ex?.gist).slice(0, 80);
  const explanation = String(ex?.explanation ?? "").trim().split(/\s+/).slice(0, 25).join(" ");
  if (!gist || !explanation) return "no explanation";

  // The same joke may already have been memed from another line.
  const { data: prior } = await supa.from("media").select("id, query").eq("room_id", o.roomId).eq("kind", "meme");
  if ((prior ?? []).some((m) => m.query.toLowerCase() === gist.toLowerCase())) return "reused";

  await supa.from("agent_messages").insert({
    room_id: o.roomId, from_member_id: o.speaker.id, to_member_id: o.listener.id, type: "note", content: explanation,
  });

  // 2. Listener's agent: pick a template and make the joke land in each language's culture.
  const list = await getTemplates(request.signal);
  if (!list.length) return "no template";
  const meme = await askJson<{ template_id?: string; text?: Record<string, { top?: string; bottom?: string }> }>(request, MODELS.agent,
    `You are ${o.listener.name}'s personal agent. Remake a dinner-table joke as a two-line meme so it lands for each language's culture
(local references and humour are welcome; keep the original joke's idea). ${KINDNESS}
Pick the template whose format fits best. Top and bottom: max 8 words each, natural in that language, no hashtags or emoji.
Templates (id: name): ${list.map((t) => `${t.id}: ${t.name}`).join("; ")}
JSON: {"template_id": "<id>", "text": {${o.langs.map((l) => `"${l}": {"top": "... in ${LANG_NAME[l]}", "bottom": "..."}`).join(", ")}}}`,
    `The joke: ${o.joke}\nWhat's funny (from ${o.speaker.name}'s agent): ${explanation}`);
  const template = list.find((t) => t.id === String(meme?.template_id ?? ""));
  if (!template) return "no template";

  // Shape the front renders: one string per language, top and bottom split by "\n".
  const caption_by_language: Record<string, string> = {};
  for (const l of o.langs) {
    const t = meme?.text?.[l];
    const top = memeLine(t?.top);
    const bottom = memeLine(t?.bottom);
    if (top || bottom) caption_by_language[l] = `${top}\n${bottom}`;
  }
  if (!Object.keys(caption_by_language).length) return "no text";

  await supa.from("media").insert({
    room_id: o.roomId, line_id: o.lineId, kind: "meme", query: gist, url: template.url,
    caption_by_language, credit: "Imgflip template", created_by_member_id: o.listener.id,
  });
  await supa.from("agent_messages").insert({
    room_id: o.roomId, from_member_id: o.listener.id, to_member_id: o.speaker.id, type: "note",
    content: `${o.listener.name}'s agent turned ${o.speaker.name}'s joke into a meme.`,
  });
  return "added";
}
