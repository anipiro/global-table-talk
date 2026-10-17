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
export type Media = T["media"]["Row"];

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
  const { DEMO_SCRIPT, DEMO_SPEAKERS, insertStep } = await import("./demoScript");
  const room = await createRoom("live");
  const { data: ms, error } = await supabase
    .from("members")
    .insert([
      { room_id: room.id, name: DEMO_SPEAKERS.en, language: "en", role: "both", facts: "Visiting Tbilisi\nLoves food\nLearning Georgian", color: COLORS[0]!, approved: true },
      { room_id: room.id, name: DEMO_SPEAKERS.ka, language: "ka", role: "talk", facts: "Grew up in Kakheti\nMakes wine\nHosts tonight", color: COLORS[1]!, approved: true },
    ])
    .select();
  if (error || !ms) throw error;
  const [you, nika] = ms as [Member, Member];
  await supabase.from("rooms").update({ host_member_id: you.id }).eq("id", room.id);
  setMemberId(room.code, you.id);
  // Scripted scene, spaced 20s apart in the recent past, in script order.
  const t0 = Date.now() - DEMO_SCRIPT.length * 20_000;
  let lastLine: string | null = null;
  for (let i = 0; i < DEMO_SCRIPT.length; i++) {
    const id = await insertStep(room.id, DEMO_SCRIPT[i]!, { ka: nika, en: you }, new Date(t0 + i * 20_000).toISOString(), lastLine);
    if (id) lastLine = id;
  }
  return room;
}
