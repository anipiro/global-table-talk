import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/ai.server", () => ({ db: () => ({}), MODELS: { image: "image" }, aiStream: vi.fn(), LANG_NAME: {}, transcribeAudio: vi.fn() }));
vi.mock("@/server/agentLoop", () => ({ askJson: vi.fn(), runAgentLoop: vi.fn() }));
vi.mock("@/server/images", () => ({ paintTonight: () => Promise.reject(new DOMException("This operation was aborted", "AbortError")) }));
vi.mock("@/server/polls", () => ({ settlePoll: vi.fn() }));
vi.mock("@/server/sharedGround", () => ({ findSharedGround: vi.fn() }));
vi.mock("@/server/health", () => ({ runHealth: vi.fn() }));
import { Route } from "./agent";

describe("painting cancellation boundary", () => {
  it("handles the reported paint abort without reporting a runtime error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const route = Route as unknown as { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } };
      const response = await route.server.handlers.POST({ request: new Request("https://example.test/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "paint", roomId: "room" }),
      }) });
      expect(response.status).toBe(499);
      expect(await response.json()).toEqual({ cancelled: true });
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});