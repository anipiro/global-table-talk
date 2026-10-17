import { describe, expect, it } from "vitest";
import { agentXp, badgesByMember, connections, harmony, levelFor, parseBadge } from "./tableLife";
import type { AgentMessage, Line, Member } from "./room";

const T0 = Date.parse("2026-10-17T18:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const line = (id: string, speaker: string, s: number, text = "one two three"): Line =>
  ({ id, room_id: "r", speaker_id: speaker, text, language: "en", created_at: at(s), ambiguous: false, confidence: 1, delay_ms: 0, heard_by: speaker, loudness: 0.5 }) as Line;
const msg = (id: string, type: string, from: string | null, to: string | null, content = "x", s = 0): AgentMessage =>
  ({ id, room_id: "r", type, from_member_id: from, to_member_id: to, content, created_at: at(s) }) as AgentMessage;
const member = (id: string) => ({ id, name: id }) as Member;

describe("agent levels", () => {
  it("levels up at 10 and 25 XP", () => {
    expect([0, 9, 10, 24, 25, 99].map(levelFor)).toEqual([1, 1, 2, 2, 3, 3]);
  });
  it("weights the agents' work and credits both sides of a 🤝 link", () => {
    const xp = agentXp({
      members: [member("a"), member("b")],
      notebook: [{ owner_member_id: "a" }] as never, media: [{ created_by_member_id: "a" }] as never,
      cards: [{ member_id: "b" }] as never, polls: [{ created_by_member_id: "b" }],
      agentMessages: [msg("1", "note", "a", "b", "🤝 found common ground: football"), msg("2", "note", "a", null, "just a note")],
    });
    expect(xp.get("a")).toBe(3 + 2 + 3);
    expect(xp.get("b")).toBe(1 + 2 + 3);
  });
});

describe("badges", () => {
  it("parses badge notes and ignores everything else", () => {
    const b = parseBadge(msg("1", "note", "a", null, "🏅 first_words | Nika — first words at the table · ნიკა — …"));
    expect(b).toMatchObject({ kind: "first_words", memberId: "a", text: "Nika — first words at the table · ნიკა — …" });
    expect(parseBadge(msg("2", "note", "a", null, "😄 banter"))).toBeNull();
    expect(parseBadge(msg("3", "note", "a", null, "🏅 unknown_kind | x"))).toBeNull();
  });
  it("keeps one badge of each kind per member", () => {
    const by = badgesByMember([
      msg("1", "note", "a", null, "🏅 bridge | one"), msg("2", "note", "a", null, "🏅 bridge | again"), msg("3", "note", "a", null, "🏅 new_word | w"),
    ]);
    expect(by.get("a")!.map((b) => b.kind)).toEqual(["bridge", "new_word"]);
  });
});

describe("harmony", () => {
  const now = T0 + 120_000;
  it("is 1 when two people share the talk evenly", () => {
    expect(harmony([line("1", "a", 0), line("2", "b", 10), line("3", "a", 20), line("4", "b", 30)], ["a", "b"], now)).toBeCloseTo(1);
  });
  it("drops when someone is left out, and counts silent members", () => {
    const h = harmony([line("1", "a", 0), line("2", "a", 10), line("3", "b", 20)], ["a", "b", "c"], now)!;
    expect(h).toBeGreaterThan(0.4);
    expect(h).toBeLessThan(0.7);
  });
  it("waits for enough talk and ignores lines older than 5 minutes", () => {
    expect(harmony([line("1", "a", 0), line("2", "b", 10)], ["a", "b"], now)).toBeNull();
    expect(harmony([line("1", "a", -400), line("2", "a", -390), line("3", "b", -380)], ["a", "b"], now)).toBeNull();
  });
});

describe("connection web", () => {
  it("links quick replies, agent exchanges and common ground", () => {
    const links = connections(
      [line("1", "a", 0), line("2", "b", 5), line("3", "c", 40)],
      [msg("m1", "ask", "c", "a"), msg("m2", "answer", "a", "c"), msg("m3", "note", "b", "c", "🤝 found common ground"), msg("m4", "bridge", "a", null)],
    );
    const w = Object.fromEntries(links.map((l) => [`${l.a}${l.b}`, l.weight]));
    expect(w).toEqual({ ab: 1, ac: 2, bc: 3 }); // b→c reply came 35 s later: no link
  });
});
