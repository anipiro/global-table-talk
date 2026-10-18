import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chat: vi.fn(() => "chat-model"), claude: vi.fn(() => "messages-model"), stream: vi.fn((options: unknown) => options) }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => ({ chat: mocks.chat }) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => mocks.claude }));
vi.mock("ai", () => ({ streamText: mocks.stream }));
import { aiStream, MODELS } from "./ai.server";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("gateway model protocols", () => {
  it("uses native Messages for the existing Claude recap model", () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only-key");
    aiStream(new Request("https://example.test"), "system", "recap", { model: MODELS.recap });
    expect(mocks.claude).toHaveBeenCalledWith("anthropic/claude-sonnet-5");
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ model: "messages-model", instructions: "system" }));
  });
  it("preserves Chat Completions for translation", () => {
    vi.stubEnv("LOVABLE_API_KEY", "test-only-key");
    aiStream(new Request("https://example.test"), "system", "translate", { model: MODELS.translate });
    expect(mocks.chat).toHaveBeenCalledWith("google/gemini-3.1-flash-lite");
    expect(mocks.claude).not.toHaveBeenCalled();
  });
});