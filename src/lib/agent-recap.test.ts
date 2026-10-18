import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { generateRecap } from "./agent";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("end-of-night scheduling", () => {
  it.each(["response", "fetch"])("quietly ends a canceled painting (%s) without retrying or blocking recap", async (kind) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      const { task } = JSON.parse(String(init.body));
      if (task === "paint") return kind === "fetch"
        ? Promise.reject(new DOMException("This operation was aborted", "AbortError"))
        : Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 499 }));
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal("fetch", fetch);
    await generateRecap("night-room");
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
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