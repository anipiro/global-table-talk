import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createStart: (factory: () => unknown) => factory(),
  createCsrfMiddleware: () => ({}),
  createMiddleware: () => ({ server: (handler: unknown) => handler }),
}));
vi.mock("@/integrations/supabase/auth-attacher", () => ({ attachSupabaseAuth: {} }));
vi.mock("./lib/error-page", () => ({ renderErrorPage: () => "error page" }));
import { startInstance } from "./start";

afterEach(() => vi.restoreAllMocks());

describe("global request cancellation boundary", () => {
  it("returns 499 without logging or rendering a crash page when cancellation escapes a handler", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const instance = startInstance as unknown as { requestMiddleware: Array<(input: { next: () => Promise<never>; request: Request }) => Promise<Response>> };
    const middleware = instance.requestMiddleware[0];
    if (!middleware) throw new Error("Missing error middleware");
    const response = await middleware({
      request: new Request("https://example.test/api/agent"),
      next: () => Promise.reject(new DOMException("This operation was aborted", "AbortError")),
    });
    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({ cancelled: true });
    expect(log).not.toHaveBeenCalled();
  });
});