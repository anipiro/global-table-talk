import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type T = Database["public"]["Tables"];
export type Room = T["rooms"]["Row"];
export type Member = T["members"]["Row"];
export type Line = T["lines"]["Row"];
export type Translation = T["translations"]["Row"];
export type AgentMessage = T["agent_messages"]["Row"];
export type NotebookEntry = T["notebook"]["Row"];
export type Photo = T["photos"]["Row"];
export type PhotoCaption = T["photo_captions"]["Row"];
export type Card = T["cards"]["Row"];
export type SpeakerCorrection = T["speaker_corrections"]["Row"];

export type Lang = "ka" | "en" | "ru";
export type Role = "talk" | "follow" | "both";

export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: "ka", label: "Georgian", native: "ქართული" },
  { id: "en", label: "English", native: "English" },
  { id: "ru", label: "Russian", native: "Русский" },
];
export const ROLES: { id: Role; label: string }[] = [
  { id: "talk", label: "I'll talk" },
  { id: "follow", label: "Help me follow" },
  { id: "both", label: "Both" },
];
const COLORS: string[] = ["#E8A35C", "#7FB7A4", "#E08C8C", "#9DB2E3", "#C7A6E0", "#E3C57F", "#8FCBD8"];

export const memberKey = (code: string) => `gamige:member:${code.toUpperCase()}`;
export const getMemberId = (code: string) =>
  typeof window === "undefined" ? null : localStorage.getItem(memberKey(code));
export const setMemberId = (code: string, id: string) => localStorage.setItem(memberKey(code), id);

export const inviteUrl = (code: string) => `${window.location.origin}/t/${code}`;


function randomCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join("");
}

export async function createRoom(status: Room["status"] = "lobby"): Promise<Room> {
  for (let i = 0; i < 6; i++) {
    const { data, error } = await supabase.from("rooms").insert({ code: randomCode(), status }).select().single();
    if (data) return data;
    if (error && error.code !== "23505") throw error;
  }
  throw new Error("Could not create a table code, try again.");
}

export async function getRoomByCode(code: string) {
  const { data, error } = await supabase.from("rooms").select().eq("code", code.toUpperCase()).maybeSingle();
  if (error) throw error;
  return data;
}

export async function joinRoom(
  room: Room,
  input: { name: string; language: Lang; role: Role; facts: string },
  inviteId?: string,
): Promise<Member> {
  const { count } = await supabase.from("members").select("id", { count: "exact", head: true }).eq("room_id", room.id);
  const isHost = !room.host_member_id;
  const { data, error } = await supabase
    .from("members")
    .insert({ room_id: room.id, ...input, color: COLORS[(count ?? 0) % COLORS.length]!, approved: isHost, invite_id: inviteId ?? null })
    .select()
    .single();
  if (error) throw error;
  if (inviteId) {
    const { data: inv } = await supabase.from("invites").select("uses").eq("id", inviteId).single();
    if (inv) await supabase.from("invites").update({ uses: inv.uses + 1 }).eq("id", inviteId);
  }
  if (isHost) await supabase.from("rooms").update({ host_member_id: data.id }).eq("id", room.id);
  setMemberId(room.code, data.id);
  return data;
}

export async function seedDemo(): Promise<Room> {
  const room = await createRoom("live");
  const { data: ms, error } = await supabase
    .from("members")
    .insert([
      { room_id: room.id, name: "You", language: "en", role: "both", facts: "Visiting Tbilisi\nLove food\nLearning Georgian", color: COLORS[0]!, approved: true },
      { room_id: room.id, name: "Nika", language: "ka", role: "talk", facts: "Grew up in Kakheti\nMakes wine\nHosts tonight", color: COLORS[1]!, approved: true },
      { room_id: room.id, name: "Anna", language: "en", role: "follow", facts: "From Berlin\nVegetarian\nFirst time in Georgia", color: COLORS[2]!, approved: true },
    ])
    .select();
  if (error || !ms) throw error;
  const [you, nika, anna] = ms as [Member, Member, Member];
  await supabase.from("rooms").update({ host_member_id: you.id }).eq("id", room.id);
  setMemberId(room.code, you.id);

  const t0 = Date.now() - 6 * 60_000;
  const at = (m: number) => new Date(t0 + m * 60_000).toISOString();
  const sample = [
    { s: nika, l: "ka", text: "გაუმარჯოს ჩვენს სტუმრებს!", en: "To our guests!", m: 0 },
    { s: anna, l: "en", text: "Thank you, this khachapuri is incredible.", ka: "გმადლობთ, ეს ხაჭაპური საოცარია.", m: 1 },
    { s: nika, l: "ka", text: "ეს ღვინო ჩემი ბაბუის მარანიდანაა.", en: "This wine is from my grandfather's cellar.", m: 2 },
    { s: you, l: "en", text: "How long has your family made wine?", ka: "რამდენი ხანია თქვენი ოჯახი ღვინოს აყენებს?", m: 3 },
    { s: nika, l: "ka", text: "სამ თაობაზე მეტია. ქვევრში ვაყენებთ.", en: "More than three generations. We make it in qvevri.", m: 4 },
  ];
  for (const x of sample) {
    const { data: line } = await supabase
      .from("lines")
      .insert({ room_id: room.id, speaker_id: x.s.id, text: x.text, language: x.l, loudness: 0.5, created_at: at(x.m) })
      .select()
      .single();
    if (!line) continue;
    const tr = [];
    if (x.en) tr.push({ line_id: line.id, language: "en", text: x.en });
    if (x.ka) tr.push({ line_id: line.id, language: "ka", text: x.ka });
    await supabase.from("translations").insert(tr);
  }
  await supabase.from("notebook").insert([
    { room_id: room.id, kind: "person", title: "Nika", body: "Host, winemaker from Kakheti.", owner_member_id: you.id },
    { room_id: room.id, kind: "glossary", title: "Qvevri (ქვევრი)", body: "Clay vessel buried underground for making wine.", owner_member_id: you.id },
    { room_id: room.id, kind: "glossary", title: "Gaumarjos (გაუმარჯოს)", body: "Cheers — literally 'victory to you'.", owner_member_id: anna.id },
    { room_id: room.id, kind: "moment", title: "First toast", body: "Nika toasted the guests.", owner_member_id: nika.id },
    { room_id: room.id, kind: "decision", title: "Cellar visit", body: "Visit the wine cellar on Sunday.", owner_member_id: nika.id },
  ]);
  await supabase.from("agent_messages").insert([
    { room_id: room.id, from_member_id: anna.id, to_member_id: nika.id, type: "ask", content: "Anna is vegetarian — anything on the table without meat?", created_at: at(1) },
    { room_id: room.id, from_member_id: nika.id, to_member_id: anna.id, type: "answer", content: "The badrijani and pkhali are meat-free.", created_at: at(2) },
    { room_id: room.id, from_member_id: you.id, to_member_id: null, type: "note", content: "Saved 'qvevri' to the glossary.", created_at: at(4) },
    { room_id: room.id, from_member_id: nika.id, to_member_id: you.id, type: "bridge", content: "Nika's toast was about welcoming guests as a gift from God.", created_at: at(5) },
  ]);
  await supabase.from("cards").insert({
    room_id: room.id, member_id: you.id, kind: "context", title: "About the toasts",
    body: "In Georgia the tamada (toastmaster) leads toasts. It's polite to wait for the toast before drinking.",
  });
  return room;
}
