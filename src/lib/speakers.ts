import { supabase } from "@/integrations/supabase/client";
import samplesFile from "./speakerSamples.json";

/** Moves a line to the right speaker; nearby flagged lines from the same wrong speaker follow.
 *  Returns the correction id (undoable). */
export async function reassignLine(lineId: string, speakerId: string, byMemberId: string | null) {
  const { data, error } = await supabase.rpc("reassign_line", {
    p_line_id: lineId,
    p_speaker_id: speakerId,
    ...(byMemberId ? { p_by_member_id: byMemberId } : {}),
  });
  if (error) throw error;
  return data as string;
}

/** Reverts a correction (only lines no later correction moved again). Returns lines restored. */
export async function undoCorrection(correctionId: string) {
  const { data, error } = await supabase.rpc("undo_speaker_correction", { p_correction_id: correctionId });
  if (error) throw error;
  return data as number;
}

export type Sample = {
  id: string;
  label: string;
  events: { utt: number; phone: "A" | "B"; text: string; loudness: number }[];
  truth: Record<string, "A" | "B">;
  ambiguous?: string[];
  voice_level?: { A: number; B: number };
};
export const SAMPLES = samplesFile.samples as Sample[];

export type SampleResult = {
  id: string;
  label: string;
  utterances: { utt: string; truth: string; predicted: string[]; correct: boolean; ambiguous: boolean; ambiguousExpected: boolean }[];
};

function code4() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join("");
}

/** Runs one labeled sample against the real server arbitration in a throwaway table, then cleans up. */
async function runSample(s: Sample): Promise<SampleResult> {
  let room: { id: string } | null = null;
  for (let i = 0; i < 6 && !room; i++) {
    const { data } = await supabase.from("rooms").insert({ code: code4(), status: "ended" }).select("id").single();
    room = data;
  }
  if (!room) throw new Error("Couldn't create a test table");
  const levels = s.voice_level ?? samplesFile.voice_level;
  try {
    const { data: ms, error } = await supabase
      .from("members")
      .insert([
        { room_id: room.id, name: "Eval A", language: "ka", approved: true, voice_level: levels.A },
        { room_id: room.id, name: "Eval B", language: "ka", approved: true, voice_level: levels.B },
      ])
      .select("id, name");
    if (error || !ms) throw error ?? new Error("Couldn't add test speakers");
    const phone = { A: ms.find((m) => m.name === "Eval A")!.id, B: ms.find((m) => m.name === "Eval B")!.id };
    const lineUtt = new Map<string, number>();
    for (const e of s.events) {
      const { data: id, error: e2 } = await supabase.rpc("insert_line", {
        p_room_id: room.id, p_speaker_id: phone[e.phone], p_text: e.text, p_language: "ka", p_loudness: e.loudness,
      });
      if (e2) throw e2;
      if (id) lineUtt.set(id, e.utt);
    }
    const { data: lines } = await supabase.from("lines").select("id, speaker_id, ambiguous").eq("room_id", room.id);
    const who = (id: string | null) => (id === phone.A ? "A" : id === phone.B ? "B" : "?");
    const utterances = Object.entries(s.truth).map(([utt, truth]) => {
      const mine = (lines ?? []).filter((l) => String(lineUtt.get(l.id)) === utt);
      const predicted = mine.map((l) => who(l.speaker_id));
      return {
        utt, truth, predicted,
        correct: predicted.length === 1 && predicted[0] === truth,
        ambiguous: mine.some((l) => l.ambiguous),
        ambiguousExpected: !!s.ambiguous?.includes(utt),
      };
    });
    return { id: s.id, label: s.label, utterances };
  } finally {
    await supabase.from("lines").delete().eq("room_id", room.id);
    await supabase.from("members").delete().eq("room_id", room.id);
    await supabase.from("rooms").delete().eq("id", room.id);
  }
}

/** Runs every labeled overlapping-speech sample, scores speaker assignment, and saves the run. */
export async function runSpeakerEval(device: string) {
  const results: SampleResult[] = [];
  for (const s of SAMPLES) results.push(await runSample(s));
  const all = results.flatMap((r) => r.utterances);
  const run = {
    total: all.length,
    correct: all.filter((u) => u.correct).length,
    ambiguous_expected: all.filter((u) => u.ambiguousExpected).length,
    ambiguous_caught: all.filter((u) => u.ambiguousExpected && u.ambiguous).length,
    device,
    details: results,
  };
  const { data, error } = await supabase.from("speaker_eval_runs").insert(run as never).select().single();
  if (error) throw error;
  return data;
}
