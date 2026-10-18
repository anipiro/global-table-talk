import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { generateRecap } from "./agent";

afterEach(() => vi.unstubAllGlobals());

describe("end-of-night scheduling", () => {
  it("starts painting before recap completes and does not wait for the picture", async () => {
    let finishRecap: ((response: Response) => void) | undefined;
    const tasks: string[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      const { task, roomId } = JSON.parse(String(init.body));
      expect(roomId).toBe("night-room");
      tasks.push(task);
      if (task === "paint") return new Promise<Response>(() => {});
      return new Promise<Response>((resolve) => { finishRecap = resolve; });
    }));
    const done = generateRecap("night-room");
    expect(tasks).toEqual(["paint", "recap"]);
    expect(finishRecap).toBeTypeOf("function");
    finishRecap?.(new Response(JSON.stringify({ ok: true })));
    await done;
  });
});