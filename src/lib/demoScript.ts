import { supabase } from "@/integrations/supabase/client";
import type { Member } from "./room";

/** Scripted dinner scene: a Georgian speaker (Nika) and an English speaker (You).
 *  Used by the Demo room seed and by "Replay demo" on the presenter view. */
export type Step =
  | { type: "line"; who: "ka" | "en"; text: string; tr: string }
  | { type: "agent"; from: "ka" | "en"; to: "ka" | "en" | null; kind: "ask" | "answer" | "note" | "missed" | "bridge"; content: string }
  | { type: "notebook"; owner: "ka" | "en"; kind: "person" | "glossary" | "decision" | "moment"; title: string; body: string }
  | { type: "card"; to: "ka" | "en"; kind: "context" | "catchup" | "recap"; title: string; body: string };

export const DEMO_SPEAKERS = { ka: "Nika", en: "You" } as const;

export const DEMO_SCRIPT: Step[] = [
  { type: "line", who: "ka", text: "გაუმარჯოს! კეთილი იყოს თქვენი მობრძანება.", tr: "Cheers! Welcome, everyone." },
  { type: "line", who: "en", text: "Thank you for having us, this table is beautiful.", tr: "გმადლობთ, რომ დაგვპატიჟეთ, ეს სუფრა მშვენიერია." },
  { type: "line", who: "ka", text: "ეს ღვინო სულხანმა გამოგზავნა.", tr: "Sulkhan sent this wine." },
  { type: "agent", from: "en", to: "ka", kind: "ask", content: "Who is Sulkhan?" },
  { type: "agent", from: "ka", to: "en", kind: "answer", content: "Nika's uncle, owns a vineyard in Kakheti." },
  { type: "notebook", owner: "en", kind: "person", title: "Sulkhan", body: "Nika's uncle, owns a vineyard in Kakheti." },
  { type: "card", to: "en", kind: "context", title: "Who's Sulkhan?", body: "Nika's uncle. He owns a vineyard in Kakheti and sent tonight's wine." },
  { type: "line", who: "en", text: "It's wonderful. Did he make it himself?", tr: "საოცარია. თვითონ დააყენა?" },
  { type: "line", who: "ka", text: "კი, ყოველ შემოდგომას რთველს აწყობს.", tr: "Yes, he holds a grape harvest every autumn." },
  { type: "notebook", owner: "ka", kind: "glossary", title: "Rtveli (რთველი)", body: "The grape harvest — a family celebration every autumn." },
  { type: "line", who: "en", text: "I'd love to see a harvest one day.", tr: "ერთ დღეს რთველის ნახვა ძალიან მინდა." },
  { type: "line", who: "ka", text: "მაშინ შემოდგომაზე კახეთში წაგიყვანთ.", tr: "Then I'll take you to Kakheti in the autumn." },
  { type: "line", who: "en", text: "Deal! To Kakheti!", tr: "შევთანხმდით! გაუმარჯოს კახეთს!" },
];

/** Inserts one scripted step. `at` sets created_at (seed uses past times; replay uses now). */
export async function insertStep(roomId: string, step: Step, cast: Record<"ka" | "en", Member>, at?: string) {
  const ts = at ? { created_at: at } : {};
  if (step.type === "line") {
    const sp = cast[step.who];
    const { data: line, error } = await supabase
      .from("lines")
      .insert({ room_id: roomId, speaker_id: sp.id, heard_by: sp.id, text: step.text, language: step.who, loudness: 0.5, confidence: 1, ...ts })
      .select("id")
      .single();
    if (error) throw error;
    await supabase.from("translations").insert({ line_id: line.id, language: step.who === "ka" ? "en" : "ka", text: step.tr });
  } else if (step.type === "agent") {
    await supabase.from("agent_messages").insert({
      room_id: roomId, from_member_id: cast[step.from].id, to_member_id: step.to ? cast[step.to].id : null,
      type: step.kind, content: step.content, ...ts,
    });
  } else if (step.type === "notebook") {
    await supabase.from("notebook").insert({ room_id: roomId, kind: step.kind, title: step.title, body: step.body, owner_member_id: cast[step.owner].id, ...ts });
  } else {
    await supabase.from("cards").insert({ room_id: roomId, member_id: cast[step.to].id, kind: step.kind, title: step.title, body: step.body, ...ts });
  }
}

/** Finds (or adds) the Georgian and English speakers of the scene in a room. */
export async function demoCast(roomId: string, members: Member[]): Promise<Record<"ka" | "en", Member>> {
  const pick = (lang: "ka" | "en") =>
    members.find((m) => m.name === DEMO_SPEAKERS[lang] && m.language === lang) ?? members.find((m) => m.language === lang && m.approved);
  let ka = pick("ka");
  let en = pick("en");
  const missing = [
    ...(ka ? [] : [{ room_id: roomId, name: DEMO_SPEAKERS.ka, language: "ka", role: "talk", color: "#7FB7A4", approved: true }]),
    ...(en ? [] : [{ room_id: roomId, name: DEMO_SPEAKERS.en, language: "en", role: "both", color: "#E8A35C", approved: true }]),
  ];
  if (missing.length) {
    const { data, error } = await supabase.from("members").insert(missing).select();
    if (error) throw error;
    ka ??= data.find((m) => m.language === "ka");
    en ??= data.find((m) => m.language === "en");
  }
  return { ka: ka!, en: en! };
}

/** Re-plays the scene into a room, one row every `gapMs` (stage fallback when live audio fails). */
export async function replayDemo(roomId: string, members: Member[], onStep?: (i: number, total: number) => void, gapMs = 2000, signal?: { cancelled: boolean }) {
  const cast = await demoCast(roomId, members);
  for (let i = 0; i < DEMO_SCRIPT.length; i++) {
    if (signal?.cancelled) return;
    await insertStep(roomId, DEMO_SCRIPT[i]!, cast);
    onStep?.(i + 1, DEMO_SCRIPT.length);
    if (i < DEMO_SCRIPT.length - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
}
