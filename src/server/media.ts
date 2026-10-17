import { LANG_NAME, MODELS, type db } from "@/lib/ai.server";

/** Feature 2 — picture references. Called by the agent loop when the trigger is `visual` or `reference`:
 *  the agent that owns the notebook entry finds a real picture on Wikipedia and shows it to the table.
 *  Free checks first (reuse, 20 s room limit), then one cheap title call, a free Wikipedia fetch, one caption call. */

type Supa = ReturnType<typeof db>;
type AskJson = <T>(request: Request, model: string, system: string, user: string) => Promise<T | null>;

const PICTURE_COOLDOWN_MS = 20_000; // max one picture per room every 20 s
const USER_AGENT = "Gamige/0.1 (hackathon dinner-table translation app; picture references for guests)";

type Summary = {
  type?: string; title?: string; description?: string; extract?: string;
  thumbnail?: { source: string; width: number };
  originalimage?: { source: string; width: number };
};

export type PictureResult = "added" | "reused" | "cooldown" | "no title" | "person" | "not found" | "disambiguation" | "no image";

/** "ხაჭაპური (Khachapuri)" → ["ხაჭაპური", "khachapuri"], so either spelling matches the same media row. */
const keys = (s: string) =>
  s.toLowerCase().split(/[()[\]]/).map((x) => x.trim()).filter((x) => x.length >= 3);
const sameThing = (a: string, b: string) =>
  keys(a).some((x) => keys(b).some((y) => x === y || x.includes(y) || y.includes(x)));

async function existing(supa: Supa, roomId: string, notebookId: string | null, subject: string) {
  const { data } = await supa.from("media").select("id, query, notebook_id").eq("room_id", roomId).eq("kind", "reference_image");
  return (data ?? []).find((m) => (notebookId && m.notebook_id === notebookId) || sameThing(m.query, subject)) ?? null;
}

async function inCooldown(supa: Supa, roomId: string) {
  const since = new Date(Date.now() - PICTURE_COOLDOWN_MS).toISOString();
  const { count } = await supa.from("media").select("id", { count: "exact", head: true })
    .eq("room_id", roomId).eq("kind", "reference_image").gte("created_at", since);
  return (count ?? 0) > 0;
}

/** Wikipedia REST summary (follows redirects). Null on 404 or network trouble. */
async function wikiSummary(title: string, signal: AbortSignal): Promise<Summary | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/ /g, "_"))}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, Accept: "application/json" }, signal });
    return res.ok ? ((await res.json()) as Summary) : null;
  } catch {
    return null;
  }
}

/** Wikipedia puts lifespans in the short description ("Argentine footballer (born 1987)", "poet (1837–1907)"). */
const PERSON = /\((born|died|b\.|d\.)\s|\(c?\.?\s?\d{3,4}\s*[–-]\s*c?\.?\s?\d{3,4}\)/;
const looksLikePerson = (s: Summary) => PERSON.test(s.description ?? "") || PERSON.test((s.extract ?? "").slice(0, 200));

/** Big originals are slow on phones: use a 1280px rendition of the thumbnail instead. */
function imageUrl(s: Summary) {
  const orig = s.originalimage;
  if (orig && (orig.width <= 1600 || !s.thumbnail)) return orig.source;
  if (s.thumbnail && /\/\d+px-/.test(s.thumbnail.source)) return s.thumbnail.source.replace(/\/\d+px-/, "/1280px-");
  return orig?.source ?? s.thumbnail?.source ?? null;
}

export async function addPicture(
  request: Request, supa: Supa, askJson: AskJson,
  o: { roomId: string; lineId: string; notebookId: string | null; subject: string; owner: { id: string; name: string }; langs: string[]; context: string },
): Promise<PictureResult> {
  // Free checks: reuse, then the room limit.
  if (await existing(supa, o.roomId, o.notebookId, o.subject)) return "reused";
  if (await inCooldown(supa, o.roomId)) return "cooldown";

  // 1. Cheap call: which English Wikipedia page shows this thing?
  const pick = await askJson<{ title?: string; kind?: string }>(request, MODELS.trigger,
    `Find the English Wikipedia article that best shows a real place, dish, landmark, object or event mentioned at a dinner table.
If it is a person, a private matter, or too vague to picture, use an empty title.
JSON: {"title": "exact English Wikipedia article title, or empty", "kind": "place|food|landmark|object|event|person|other"}`,
    `Thing: ${o.subject}\nConversation:\n${o.context}`);
  const title = String(pick?.title ?? "").trim();
  if (pick?.kind === "person") return "person";
  if (!title) return "no title";

  // 2. Free Wikipedia lookup.
  const page = await wikiSummary(title, request.signal);
  if (!page) return "not found";
  if (page.type === "disambiguation") return "disambiguation";
  if (looksLikePerson(page)) return "person";
  const url = imageUrl(page);
  if (!url) return "no image";

  // Another line may have added the same picture while we were looking.
  if (await existing(supa, o.roomId, o.notebookId, page.title ?? title)) return "reused";

  // 3. One-line caption for every language at the table.
  const pageTitle = page.title ?? title;
  const caps = await askJson<Record<string, string>>(request, MODELS.translate,
    "Write a one-line picture caption (max 10 words) for guests at a dinner table. Name the thing, add one helpful detail. No quotes.",
    `Picture: ${pageTitle}${page.description ? ` — ${page.description}` : ""}\nAbout: ${(page.extract ?? "").slice(0, 400)}
Languages: ${o.langs.map((l) => `${l} (${LANG_NAME[l]})`).join(", ")}\nJSON: {"<code>": "<caption>"}`);
  const caption_by_language: Record<string, string> = {};
  for (const l of o.langs) if (caps?.[l]) caption_by_language[l] = String(caps[l]).trim();
  if (!caption_by_language["en"]) caption_by_language["en"] = page.description ? `${pageTitle} — ${page.description}` : pageTitle;

  await supa.from("media").insert({
    room_id: o.roomId, line_id: o.lineId, notebook_id: o.notebookId, kind: "reference_image",
    query: pageTitle, url, caption_by_language, credit: "Wikipedia", created_by_member_id: o.owner.id,
  });
  await supa.from("agent_messages").insert({
    room_id: o.roomId, from_member_id: o.owner.id, type: "note", content: `${o.owner.name}'s agent added a photo of ${pageTitle}.`,
  });
  return "added";
}
