import { generateImage, IMAGE, LANG_NAME, MODELS, type db } from "@/lib/ai.server";
import { NO_PEOPLE, storeGenerated } from "./images";
import { BANNED } from "./banter";
import { ROAST_MEME_CHANCE, ROAST_MEME_PREFIX, roastMemeAllowed, roastSlotId } from "./roastMemeBudget";

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
  const { data: room, error: roomError } = await supa.from("rooms").select("roast_mode, status").eq("id", o.roomId).single();
  if (roomError || !room) return "cooldown";
  if (room.roast_mode) return addPaintedRoast(request, supa, askJson, o);

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

/** One image shared by every language; localized captions stay in the existing UI overlay. */
async function addPaintedRoast(request: Request, supa: Supa, askJson: AskJson, o: Parameters<typeof addMeme>[3]): Promise<MemeResult> {
  const { data: attempts, error } = await supa.from("agent_messages").select("created_at, content")
    .eq("room_id", o.roomId).like("content", `${ROAST_MEME_PREFIX}%`);
  if (error || !roastMemeAllowed(attempts ?? [], Date.now())) return "cooldown";
  const { count, error: linesError } = await supa.from("lines").select("id", { count: "exact", head: true })
    .eq("room_id", o.roomId).not("speaker_id", "is", null).gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if (linesError || (count ?? 0) < 4 || Math.random() >= ROAST_MEME_CHANCE) return "cooldown";
  const id = await roastSlotId(o.roomId, (attempts ?? []).length);
  const { error: claimError } = await supa.from("agent_messages").insert({
    id, room_id: o.roomId, from_member_id: o.listener.id, type: "note", content: `${ROAST_MEME_PREFIX}the agents are painting a meme…`,
  });
  if (claimError) return "cooldown"; // includes primary-key collision: another phone won
  try {
    const plan = await askJson<{ safe?: boolean; gist?: string; scene?: string; text?: Record<string, { top?: string; bottom?: string }> }>(request, MODELS.banter,
      `Make one kind painted roast meme about agents or a harmless situation from spoken conversation only. Never use private profile facts.
Hard bans: appearance, weight, age, money, health, relationships, religion, politics, nationality stereotypes, real people's likenesses or copyrighted characters. If unsure set safe=false.
Use a playful two-panel scene with objects or imaginary translator machines only; no people or lettering. English scene max 45 words, gist max 6 words.
JSON: {"safe":true|false,"gist":"...","scene":"...","text":{${o.langs.map((l) => `"${l}":{"top":"max 8 words in ${LANG_NAME[l]}","bottom":"max 8 words"}`).join(",")}}}`,
      `Spoken conversation:\n${o.context}\nJoke: ${o.joke}`);
    const gist = memeLine(plan?.gist).slice(0, 80);
    const scene = String(plan?.scene ?? "").trim().split(/\s+/).slice(0, 45).join(" ");
    if (plan?.safe !== true || !gist || !scene || BANNED.test(`${gist} ${scene}`)) {
      await supa.from("agent_messages").update({ content: `${ROAST_MEME_PREFIX}skipped — keeping it kind.` }).eq("id", id);
      return "unkind";
    }
    const { data: prior, error: priorError } = await supa.from("media").select("query").eq("room_id", o.roomId).eq("kind", "meme");
    if (priorError) throw new Error("Couldn't check existing memes");
    if ((prior ?? []).some((m) => m.query.toLowerCase() === gist.toLowerCase())) {
      await supa.from("agent_messages").update({ content: `${ROAST_MEME_PREFIX}reusing the table's earlier meme.` }).eq("id", id);
      return "reused";
    }
    const caption_by_language: Record<string, string> = {};
    for (const l of o.langs) {
      const t = plan.text?.[l];
      if (t?.top && t.bottom) caption_by_language[l] = `${memeLine(t.top)}\n${memeLine(t.bottom)}`;
    }
    if (!Object.keys(caption_by_language).length) throw new Error("No meme captions were generated");
    const img = await generateImage(request, `Playful painted two-panel cartoon meme background, crisp expressive objects, clear bright composition. ${scene} ${NO_PEOPLE}`, IMAGE.meme);
    const url = await storeGenerated(supa, o.roomId, img);
    const { error: saveError } = await supa.from("media").insert({ room_id: o.roomId, line_id: o.lineId, kind: "meme", query: gist, url,
      caption_by_language, credit: "AI illustration", created_by_member_id: o.listener.id });
    if (saveError) throw new Error("Couldn't save the painted meme");
    await supa.from("agent_messages").update({ content: `${ROAST_MEME_PREFIX}${o.listener.name}'s agent turned the joke into a painted meme.` }).eq("id", id);
    return "added";
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    const paused = status === 402 || status === 403 || status === 404;
    await supa.from("agent_messages").update({ content: `${ROAST_MEME_PREFIX}${paused ? "[paused] " : ""}${e instanceof Error ? e.message.slice(0, 250) : "Painting stopped."}` }).eq("id", id);
    throw e; // no retries; failed attempts also consume a slot
  }
}
