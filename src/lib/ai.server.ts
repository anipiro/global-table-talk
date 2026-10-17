import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";
const RUN_ID = "X-Lovable-AIG-Run-ID";

export function db() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/** Streams a model call through Lovable AI. Use `.text` for the final answer or `.toTextStreamResponse()` to stream to the browser. */
export function aiStream(
  request: Request,
  system: string,
  user: string,
  opts: { imageUrl?: string; onFinish?: (text: string) => Promise<void> | void } = {},
) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured");
  let runId = request.headers.get(RUN_ID) ?? undefined;
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const h = new Headers(init?.headers);
      if (runId && !h.has(RUN_ID)) h.set(RUN_ID, runId);
      const res = await fetch(input, { ...init, headers: h });
      runId ??= res.headers.get(RUN_ID) ?? undefined;
      return res;
    },
  });
  const messages: ModelMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: opts.imageUrl
        ? [
            { type: "text", text: user },
            { type: "image", image: new URL(opts.imageUrl) },
          ]
        : user,
    },
  ];
  return streamText({
    model: provider.responses(MODEL),
    messages,
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
    onFinish: opts.onFinish ? ({ text }) => opts.onFinish!(text) : undefined,
  });
}

export const LANG_NAME: Record<string, string> = { ka: "Georgian", en: "English", ru: "Russian" };
