import { describe, expect, it, vi } from "vitest";
import { findSharedGround } from "./sharedGround";
import type { db } from "@/lib/ai.server";

vi.mock("@/lib/ai.server", () => ({ LANG_NAME: { en: "English", ka: "Georgian" }, MODELS: { trigger: "cheap" } }));

function setup(topic = "shopping") {
  const people = [
    { id: "anna", name: "Anna", language: "en", role: "both", facts: "", approved: true },
    { id: "kato", name: "Kato", language: "en", role: "both", facts: "", approved: true },
    { id: "waiting", name: "Waiting", language: "en", role: "both", facts: "Shopping", approved: false },
  ];
  const writes: { table: string; rows: unknown }[] = [];
  const prompts: string[] = [];
  const query = (table: string) => {
    const q = {
      select: () => q, eq: () => q, like: () => q, gte: () => q, order: () => q, limit: () => q,
      insert: async (rows: unknown) => { writes.push({ table, rows }); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => resolve({
        data: table === "members" ? people : table === "lines" ? [
          { speaker_id: "kato", text: "I like shopping too" },
          { speaker_id: null, text: "I like politics" },
          { speaker_id: "anna", text: "I like shopping" },
        ] : [], count: 0, error: null,
      }),
    };
    return q;
  };
  const supa = { from: query } as unknown as ReturnType<typeof db>;
  const ask = vi.fn(async (_r: Request, _m: string, _s: string, user: string) => {
    prompts.push(user);
    return { overlaps: [{ pair: "P1-P2", topic, cards: { P1: "Kato also likes shopping — ask about her favourite shops.", P2: "Anna also likes shopping — ask about her favourite shops." } }] };
  });
  return { supa, ask: ask as unknown as Parameters<typeof findSharedGround>[2], writes, prompts };
}

describe("spoken shared interests", () => {
  it("finds shopping from attributed speech even with no typed facts and matching languages", async () => {
    const s = setup();
    expect(await findSharedGround(new Request("https://example.test"), s.supa, s.ask, "room")).toEqual({ found: 1 });
    expect(s.prompts[0]).toContain("P1: I like shopping");
    expect(s.prompts[0]).toContain("P2: I like shopping too");
    expect(s.writes.find((w) => w.table === "cards")?.rows).toEqual([
      expect.objectContaining({ member_id: "anna", kind: "shared" }),
      expect.objectContaining({ member_id: "kato", kind: "shared" }),
    ]);
    expect(s.writes.find((w) => w.table === "agent_messages")?.rows).toEqual(expect.objectContaining({ content: "🤝 Anna's agent and Kato's agent found common ground: shopping" }));
  });
  it("does not pass unknown-speaker speech or waiting guests to the checker", async () => {
    const s = setup();
    await findSharedGround(new Request("https://example.test"), s.supa, s.ask, "room");
    expect(s.prompts[0]).not.toContain("politics");
    expect(s.prompts[0]).not.toContain("Waiting");
  });
  it("rejects sensitive shared topics", async () => {
    const s = setup("politics");
    expect(await findSharedGround(new Request("https://example.test"), s.supa, s.ask, "room")).toEqual({ found: 0 });
    expect(s.writes).toHaveLength(0);
  });
});