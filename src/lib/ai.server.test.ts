import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chat: vi.fn(() => "chat-model"), claude: vi.fn(() => "messages-model"), stream: vi.fn((options: unknown) => options) }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => ({ chat: mocks.chat }) }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => mocks.claude }));
vi.mock("ai", () => ({ streamText: mocks.stream }));
import { aiStream, generateImage, IMAGE, MODELS } from "./ai.server";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
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

it("buys one low-quality Flare image for memes without changing recap settings", async () => {
  vi.stubEnv("LOVABLE_API_KEY", "test-only-key");
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "YQ==" }] })));
  vi.stubGlobal("fetch", fetcher);
  await generateImage(new Request("https://example.test"), "objects only", IMAGE.meme);
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ model: "openai/gpt-image-2.5-flare", prompt: "objects only", n: 1, quality: "low", size: "1024x1024" });
  expect(IMAGE.painted).toEqual({ quality: "high", size: "1536x1024" });
});