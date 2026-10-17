import { aiStream, LANG_NAME, type db } from "@/lib/ai.server";

/** Feature 1 — the agent loop. Runs once per new line (called after its translations are saved):
 *  1. free checks (is there a listener? cooldown? is the line worth a look?)
 *  2. cheap trigger call on the latest line + last ~5 lines
 *  3. on a trigger: listener's agent asks → speaker's agent answers → one notebook entry → context cards.
 *  Reuse first: if the notebook already has the subject, the listener's agent points to it instead. */

type Supa = ReturnType<typeof db>;
type Trigger = "none" | "unknown_name" | "reference" | "joke" | "decision" | "visual" | "missed";
type Member = { id: string; name: string; language: string; facts: string; role: string };

const COOLDOWN_MS = 15_000; // max one agent exchange per room every 15 s
const LOOP_TYPES = ["ask", "answer", "note", "missed"]; // "bridge" is written by translate on every line
const NOTEBOOK_KIND: Partial<Record<Trigger, string>> = {
  unknown_name: "person", reference: "glossary", visual: "glossary", joke: "moment",
};

export type LoopResult = { ok: true; trigger?: Trigger; skipped?: string; reused?: boolean };

async function inCooldown(supa: Supa, roomId: string) {
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { count } = await supa.from("agent_messages").select("id", { count: "exact", head: true })
    .eq("room_id", roomId).in("type", LOOP_TYPES).gte("created_at", since);
  return (count ?? 0) > 0;
}

/** Free pre-filter so we don't spend credits on "yeah", "mm-hm", "ok ok". */
function worthALook(text: string) {
  const t = text.trim();
  if (t.length < 3) return false;
  if (/[?？]/.test(t)) return true;
  return t.split(/\s+/).length >= 3;
}

/** Model output → object, tolerating ```json fences and stray text around it. */
function parseJson<T>(raw: string): T | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

async function askJson<T>(request: Request, system: string, user: string) {
  const r = aiStream(request, `${system}\nReply with one JSON object only, no other text.`, user);
  return parseJson<T>(await r.text);
}

const clip = (s: unknown, words = 25) => String(s ?? "").trim().split(/\s+/).slice(0, words).join(" ");

/** Recent lines, each shown in the original plus its English translation when there is one. */
async function recentLines(supa: Supa, roomId: string, members: Member[], limit: number) {
  const { data: lines } = await supa.from("lines").select("id, speaker_id, text, language")
    .eq("room_id", roomId).order("created_at", { ascending: false }).limit(limit);
  const list = (lines ?? []).reverse();
  const ids = list.filter((l) => l.language !== "en").map((l) => l.id);
  const { data: tr } = ids.length
    ? await supa.from("translations").select("line_id, text").in("line_id", ids).eq("language", "en")
    : { data: [] };
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Someone";
  return list.map((l) => {
    const en = tr?.find((x) => x.line_id === l.id)?.text;
    return `${name(l.speaker_id)}: ${l.text}${en ? ` (= ${en})` : ""}`;
  }).join("\n");
}

export async function runAgentLoop(request: Request, supa: Supa, lineId: string): Promise<LoopResult> {
  const { data: line } = await supa.from("lines").select("id, room_id, speaker_id, text, language").eq("id", lineId).single();
  if (!line?.speaker_id) return { ok: true, skipped: "no line" };
  const roomId = line.room_id;

  const { data: all } = await supa.from("members").select("id, name, language, facts, role, approved").eq("room_id", roomId);
  const members: Member[] = (all ?? []).filter((m) => m.approved);
  const speaker = members.find((m) => m.id === line.speaker_id);
  if (!speaker) return { ok: true, skipped: "no speaker" };
  const listeners = members.filter((m) => m.language !== speaker.language);
  if (!listeners.length) return { ok: true, skipped: "no listener" };
  if (!worthALook(line.text)) return { ok: true, skipped: "filler" };
  if (await inCooldown(supa, roomId)) return { ok: true, skipped: "cooldown" };

  // 2. Cheap trigger check.
  const context = await recentLines(supa, roomId, members, 6);
  const trig = await askJson<{ trigger?: Trigger; subject?: string; ask?: string }>(request,
    `You watch a dinner-table conversation for the personal agents of guests who don't speak ${LANG_NAME[speaker.language]}.
Decide if the LATEST line needs the agents' help. Be strict: most lines are "none".
- unknown_name: a person (not at the table) the listeners can't know.
- reference: culture, song, film, meme, place, event or custom a foreigner may not know.
- visual: a place, dish or object that would be clearer as a picture.
- joke: humour or wordplay that won't survive translation.
- decision: the table just agreed on a plan.
- missed: the speaker sounds lost ("what?", "I don't follow").
People at the table (never unknown): ${members.map((m) => m.name).join(", ")}.
JSON: {"trigger": "none|unknown_name|reference|visual|joke|decision|missed", "subject": "the name/thing, original spelling plus English in brackets if different", "ask": "max 12-word question, in English, from a listener's agent to ${speaker.name}'s agent"}`,
    `Last lines:\n${context}\n\nLATEST line (by ${speaker.name}): ${line.text}`);
  const trigger = trig?.trigger ?? "none";
  if (trigger === "none" || !(trigger in NOTEBOOK_KIND || trigger === "decision" || trigger === "missed")) {
    return { ok: true, trigger: "none" };
  }
  // The trigger call takes a few seconds; another line may have started an exchange meanwhile.
  if (await inCooldown(supa, roomId)) return { ok: true, trigger, skipped: "cooldown" };

  if (trigger === "missed") return missed(request, supa, roomId, speaker, context);
  const subject = clip(trig?.subject, 8);
  if (!subject) return { ok: true, trigger: "none" };
  if (trigger === "decision") return decision(request, supa, roomId, speaker, listeners, subject, context);
  return exchange(request, supa, roomId, trigger, speaker, listeners, subject, clip(trig?.ask, 15), context);
}

/** Notebook entry with the same subject, if any agent already wrote one. */
async function findEntry(supa: Supa, roomId: string, subject: string) {
  const key = subject.replace(/\s*[([].*$/, "").trim().toLowerCase(); // "სულხანი (Sulkhan)" → "სულხანი"
  const { data } = await supa.from("notebook").select("id, title, body, owner_member_id").eq("room_id", roomId);
  return (data ?? []).find((n) => {
    const t = n.title.toLowerCase();
    return t.includes(key) || key.includes(t.replace(/\s*[([].*$/, "").trim());
  }) ?? null;
}

/** Context cards, one per listener, skipping anyone who already has a card with this title. */
async function sendCards(supa: Supa, roomId: string, listeners: Member[], title: string, byLang: Record<string, string>) {
  const { data: have } = await supa.from("cards").select("member_id").eq("room_id", roomId).eq("kind", "context").eq("title", title);
  const got = new Set((have ?? []).map((c) => c.member_id));
  const rows = listeners.filter((m) => !got.has(m.id) && byLang[m.language])
    .map((m) => ({ room_id: roomId, member_id: m.id, kind: "context", title, body: byLang[m.language]! }));
  if (rows.length) await supa.from("cards").insert(rows);
}

/** Writes card text for each listener language, ≤ 2 sentences each. Reuses earlier cards with the same title. */
async function cardsFor(request: Request, supa: Supa, roomId: string, title: string, englishBody: string, langs: string[]) {
  const out: Record<string, string> = {};
  const { data: prior } = await supa.from("cards").select("body, member_id").eq("room_id", roomId).eq("kind", "context").eq("title", title);
  if (prior?.length) {
    const { data: ms } = await supa.from("members").select("id, language").in("id", prior.map((p) => p.member_id!).filter(Boolean));
    for (const p of prior) {
      const lang = ms?.find((m) => m.id === p.member_id)?.language;
      if (lang && !out[lang]) out[lang] = p.body;
    }
  }
  if (langs.includes("en") && !out["en"]) out["en"] = englishBody;
  const todo = langs.filter((l) => !out[l]);
  if (todo.length) {
    const tr = await askJson<Record<string, string>>(request,
      "Translate a short dinner-table context note. Keep names; keep it warm and at most 2 sentences.",
      `Languages: ${todo.map((l) => `${l} (${LANG_NAME[l]})`).join(", ")}\nNote: ${englishBody}\nJSON: {"<code>": "<translation>"}`);
    for (const l of todo) if (tr?.[l]) out[l] = String(tr[l]);
  }
  return out;
}

async function exchange(
  request: Request, supa: Supa, roomId: string, trigger: Trigger,
  speaker: Member, listeners: Member[], subject: string, ask: string, context: string,
): Promise<LoopResult> {
  const asker = listeners.find((m) => m.role !== "talk") ?? listeners[0]!;
  const langs = [...new Set(listeners.map((m) => m.language))];

  // Reuse before creating: another agent already explained this.
  const existing = await findEntry(supa, roomId, subject);
  if (existing) {
    const { data: have } = await supa.from("cards").select("member_id").eq("room_id", roomId).eq("kind", "context").eq("title", existing.title);
    const got = new Set((have ?? []).map((c) => c.member_id));
    const need = listeners.filter((m) => !got.has(m.id));
    if (!need.length) return { ok: true, trigger, skipped: "already known", reused: true };
    const { data: owner } = existing.owner_member_id
      ? await supa.from("members").select("name").eq("id", existing.owner_member_id).maybeSingle()
      : { data: null };
    const ownerName = owner?.name;
    await supa.from("agent_messages").insert({
      room_id: roomId, from_member_id: need[0]!.id, to_member_id: existing.owner_member_id, type: "note",
      content: clip(`Found “${existing.title}” in the notebook${ownerName ? ` from ${ownerName}'s agent` : ""} — passing it on.`),
    });
    const byLang = await cardsFor(request, supa, roomId, existing.title, existing.body, [...new Set(need.map((m) => m.language))]);
    await sendCards(supa, roomId, need, existing.title, byLang);
    return { ok: true, trigger, reused: true };
  }

  // 1. Listener's agent asks the speaker's agent (shows up on screen right away).
  await supa.from("agent_messages").insert({
    room_id: roomId, from_member_id: asker.id, to_member_id: speaker.id, type: "ask",
    content: ask || `What is “${subject}”?`,
  });

  // 2. Speaker's agent answers from its human's facts + what was said.
  const res = await askJson<{ known?: boolean; answer?: string; title?: string; body?: string; cards?: Record<string, string> }>(request,
    `You are ${speaker.name}'s personal agent at a dinner table: warm, brief, a bit witty, never condescending.
${asker.name}'s agent asked you about "${subject}".
What ${speaker.name} told you about themselves: ${speaker.facts || "(nothing)"}
Rules:
- About PEOPLE: state only what is in those facts or was said out loud below. Never invent. If you don't know, set known=false.
- About culture, places, food, songs, customs: general knowledge is fine.
- Never share health, money or relationship details unless they were said out loud.
${trigger === "joke" ? "- Explain in one line why it's funny. Keep it kind; never mock anyone at the table.\n" : ""}JSON: {"known": true|false,
 "answer": "max 25 words, in English, your reply to ${asker.name}'s agent",
 "title": "notebook title: the name/term, original spelling plus English in brackets if different",
 "body": "max 2 short sentences, English, what a guest should know",
 "cards": {${langs.map((l) => `"${l}": "max 2 sentences in ${LANG_NAME[l]} for ${listeners.filter((m) => m.language === l).map((m) => m.name).join("/")}"`).join(", ")}}}`,
    `Conversation:\n${context}`);
  if (!res) return { ok: true, trigger, skipped: "no answer" };

  if (res.known === false) {
    await supa.from("agent_messages").insert({
      room_id: roomId, from_member_id: speaker.id, to_member_id: asker.id, type: "answer",
      content: `Not sure — ${speaker.name} didn't mention.`,
    });
    return { ok: true, trigger };
  }
  await supa.from("agent_messages").insert({
    room_id: roomId, from_member_id: speaker.id, to_member_id: asker.id, type: "answer", content: clip(res.answer),
  });

  // 3. One notebook entry, owned by the speaker's agent.
  const title = clip(res.title || subject, 8);
  const body = clip(res.body || res.answer, 40);
  await supa.from("notebook").insert({ room_id: roomId, kind: NOTEBOOK_KIND[trigger]!, title, body, owner_member_id: speaker.id });

  // 4. Private context cards, each in the listener's language.
  const byLang: Record<string, string> = {};
  for (const l of langs) if (res.cards?.[l]) byLang[l] = clip(res.cards[l], 40);
  const missing = langs.filter((l) => !byLang[l]);
  if (missing.length) Object.assign(byLang, await cardsFor(request, supa, roomId, title, body, missing));
  await sendCards(supa, roomId, listeners, title, byLang);
  return { ok: true, trigger };
}

async function decision(
  request: Request, supa: Supa, roomId: string, speaker: Member, listeners: Member[], subject: string, context: string,
): Promise<LoopResult> {
  if (await findEntry(supa, roomId, subject)) return { ok: true, trigger: "decision", skipped: "already known", reused: true };
  const langs = [...new Set(listeners.map((m) => m.language))];
  const res = await askJson<{ title?: string; body?: string; cards?: Record<string, string> }>(request,
    `You are ${speaker.name}'s personal agent. The table just agreed on something. Record it plainly; don't invent details.
JSON: {"title": "max 6 words, English", "body": "one sentence, English: who agreed to what, when", "cards": {${langs.map((l) => `"${l}": "one sentence in ${LANG_NAME[l]}"`).join(", ")}}}`,
    `Conversation:\n${context}\n\nDecision about: ${subject}`);
  if (!res?.title) return { ok: true, trigger: "decision", skipped: "no answer" };
  const title = clip(res.title, 8);
  await supa.from("notebook").insert({ room_id: roomId, kind: "decision", title, body: clip(res.body, 40), owner_member_id: speaker.id });
  await supa.from("agent_messages").insert({
    room_id: roomId, from_member_id: speaker.id, type: "note", content: clip(`Noted a plan: ${title}.`),
  });
  const byLang: Record<string, string> = {};
  for (const l of langs) if (res.cards?.[l]) byLang[l] = clip(res.cards[l], 40);
  await sendCards(supa, roomId, listeners, title, byLang);
  return { ok: true, trigger: "decision" };
}

/** The speaker sounds lost: their own agent quietly catches them up in their language. */
async function missed(request: Request, supa: Supa, roomId: string, lost: Member, context: string): Promise<LoopResult> {
  await supa.from("agent_messages").insert({
    room_id: roomId, from_member_id: lost.id, type: "missed", content: `${lost.name} looks lost — catching them up.`,
  });
  const r = aiStream(request,
    `You are ${lost.name}'s personal agent, whispering like a friend. In ${LANG_NAME[lost.language]}, max 2 short sentences: what is being talked about right now. No preamble.`,
    `Conversation:\n${context}`);
  const body = (await r.text).trim();
  if (body) await supa.from("cards").insert({ room_id: roomId, member_id: lost.id, kind: "context", title: "Right now", body });
  return { ok: true, trigger: "missed" };
}
