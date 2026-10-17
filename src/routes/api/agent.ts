import { createFileRoute } from "@tanstack/react-router";
import { aiStream, db, LANG_NAME, MODELS, transcribeAudio } from "@/lib/ai.server";
import { askJson, runAgentLoop } from "@/server/agentLoop";
import { paintTonight } from "@/server/images";
import { runHealth } from "@/server/health";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function aiError(e: unknown) {
  const status = (e as { statusCode?: number })?.statusCode ?? 500;
  const msg =
    status === 402 ? "Lovable AI credits have run out. Add credits in workspace settings."
    : status === 429 ? "The agents are busy — try again in a moment."
    : e instanceof Error ? e.message : "Agent error";
  return json({ error: msg }, status === 402 || status === 429 || status === 403 ? status : 500);
}

async function transcript(supa: ReturnType<typeof db>, roomId: string, lang: string, limit = 60) {
  const { data: members } = await supa.from("members").select("id, name, facts, language").eq("room_id", roomId);
  const { data: lines } = await supa
    .from("lines").select("id, speaker_id, text, language, created_at").eq("room_id", roomId)
    .order("created_at", { ascending: false }).limit(limit);
  const ids = (lines ?? []).map((l) => l.id);
  const { data: tr } = ids.length
    ? await supa.from("translations").select("line_id, language, text").in("line_id", ids).eq("language", lang)
    : { data: [] };
  const name = (id: string | null) => members?.find((m) => m.id === id)?.name ?? "Unknown speaker";
  const text = (lines ?? []).reverse().map((l) => {
    const t = l.language === lang ? null : tr?.find((x) => x.line_id === l.id)?.text;
    return `${name(l.speaker_id)}: ${l.text}${t ? ` (= ${t})` : ""}`;
  }).join("\n");
  return { members: members ?? [], text };
}

async function handleTranscribe(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Missing audio file" }, 400);
    const hint = String(form.get("language") ?? "") || undefined;
    const { text, language } = await transcribeAudio(request, file, hint);
    return json({ text, language: language ?? hint ?? null, model: MODELS.transcribe });
  } catch (e) {
    console.error("transcribe error", e);
    return aiError(e);
  }
}

async function handle(request: Request) {
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) return handleTranscribe(request);
  const body = (await request.json()) as { task: string; lineId: string; memberId: string; photoId: string; roomId: string; images?: boolean };
  const supa = db();
  try {
    if (body.task === "translate") {
      const { data: line } = await supa.from("lines").select().eq("id", body.lineId).single();
      if (!line) return json({ error: "Line not found" }, 404);
      const { data: members } = await supa.from("members").select("id, name, language").eq("room_id", line.room_id);
      const targets = [...new Set((members ?? []).map((m) => m.language))].filter((l) => l !== line.language);
      const { text: context } = await transcript(supa, line.room_id, line.language, 8);
      await Promise.all(targets.map(async (lang) => {
        const r = aiStream(request,
          `You translate dinner-table speech from ${LANG_NAME[line.language]} to ${LANG_NAME[lang]}. Keep tone, names and toasts natural. Reply with the translation only.`,
          `Recent conversation for context:\n${context}\n\nTranslate this line:\n${line.text}`,
          { model: MODELS.translate });
        const text = (await r.text).trim();
        if (text) await supa.from("translations").insert({ line_id: line.id, language: lang, text });
      }));
      if (targets.length) {
        await supa.from("agent_messages").insert({
          room_id: line.room_id, from_member_id: line.speaker_id, type: "bridge",
          content: `Passed “${line.text.slice(0, 60)}” along in ${targets.map((l) => LANG_NAME[l]).join(", ")}.`,
        });
      }
      return json({ ok: true, languages: targets, model: MODELS.translate });
    }

    if (body.task === "paint") {
      return json({ ok: true, painted: await paintTonight(request, supa, askJson, body.roomId), model: MODELS.image });
    }

    if (body.task === "health") {
      return json(await runHealth(request, body.images !== false));
    }

    if (body.task === "agent") {
      return json(await runAgentLoop(request, supa, body.lineId));
    }

    if (body.task === "catchup") {
      const { data: me } = await supa.from("members").select().eq("id", body.memberId).single();
      if (!me) return json({ error: "Member not found" }, 404);
      const { text } = await transcript(supa, me.room_id, me.language, 40);
      await supa.from("agent_messages").insert({ room_id: me.room_id, from_member_id: me.id, type: "ask", content: `${me.name}'s agent asked for a catch-up.` });
      const r = aiStream(request,
        `You are ${me.name}'s personal agent at a dinner table. Write in ${LANG_NAME[me.language]}. In 3-5 short sentences, tell them what's being discussed right now and anything they may have missed. Be warm and concise. About them: ${me.facts}`,
        text || "Nobody has spoken yet.",
        { model: MODELS.catchup, onFinish: async (out) => {
          if (out.trim()) await supa.from("cards").insert({ room_id: me.room_id, member_id: me.id, kind: "catchup", title: "Catch-up", body: out.trim() });
        } });
      return r.toTextStreamResponse({ headers: { "X-Gamige-Model": MODELS.catchup } });
    }

    if (body.task === "describe") {
      const { data: photo } = await supa.from("photos").select().eq("id", body.photoId).single();
      if (!photo) return json({ error: "Photo not found" }, 404);
      const { data: signed } = await supa.storage.from("photos").createSignedUrl(photo.storage_path, 600);
      if (!signed) return json({ error: "Photo not readable" }, 500);
      const { data: members } = await supa.from("members").select("language").eq("room_id", photo.room_id);
      const langs = [...new Set((members ?? []).map((m) => m.language))];
      const r = aiStream(request,
        "You describe photos shared at a dinner table. For each requested language output exactly one line: CODE|short caption (max 8 words)|one-sentence description. No other text.",
        `Languages: ${langs.map((l) => `${l} (${LANG_NAME[l]})`).join(", ")}`,
        { model: MODELS.describe, imageUrl: signed.signedUrl });
      const out = await r.text;
      const rows = out.split("\n").map((l) => l.split("|").map((s) => s.trim()))
        .filter((p) => p.length >= 3 && langs.includes(p[0]!))
        .map((p) => ({ photo_id: photo.id, language: p[0]!, caption: p[1]!, description: p[2]! }));
      if (rows.length) await supa.from("photo_captions").insert(rows);
      return json({ ok: true, model: MODELS.describe });
    }

    if (body.task === "recap") {
      const { members, text } = await transcript(supa, body.roomId, "en", 200);
      const { data: notes } = await supa.from("notebook").select("kind, title, body").eq("room_id", body.roomId);
      const notesText = (notes ?? []).map((n) => `[${n.kind}] ${n.title}: ${n.body}`).join("\n");
      await Promise.all(members.map(async (m) => {
        const r = aiStream(request,
          `You are ${m.name}'s personal agent. Write a warm recap of tonight's dinner in ${LANG_NAME[m.language]}: who was there, the best moments, words learned, and any plans made. 5-8 sentences. About them: ${m.facts}`,
          `Guests: ${members.map((x) => x.name).join(", ")}\n\nNotebook:\n${notesText}\n\nConversation:\n${text}`,
          { model: MODELS.recap });
        const out = (await r.text).trim();
        if (out) await supa.from("cards").insert({ room_id: body.roomId, member_id: m.id, kind: "recap", title: "Your night", body: out });
      }));
      return json({ ok: true, model: MODELS.recap });
    }
    return json({ error: "Unknown task" }, 400);
  } catch (e) {
    console.error("agent error", e);
    return aiError(e);
  }
}

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      // Open /api/agent?task=health in a browser to check every AI model after a push.
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams;
        return q.get("task") === "health" ? json(await runHealth(request, q.get("images") !== "0")) : json({ error: "Use POST" }, 405);
      },
    },
  },
});
