import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Gateway model per job — swap them here. Anything not listed falls back to `default`. */
export const MODELS = {
  default: "openai/gpt-6-astra",
  trigger: "openai/gpt-6-luna", // cheap check on every line
  translate: "google/gemini-3.1-flash-lite",
  agent: "google/gemini-3.8-flash", // agent answers, decisions, "right now" cards
  catchup: "google/gemini-3.8-flash",
  describe: "google/gemini-3.8-flash",
  recap: "anthropic/claude-sonnet-5", // also the tamada toast
  toast: "anthropic/claude-sonnet-5",
  transcribe: "google/gemini-3.5-transcribe",
} as const;

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const RUN_ID = "X-Lovable-AIG-Run-ID";

/** Turns reasoning off in the request body, in each provider's own dialect. */
function withoutReasoning(model: string, body: Record<string, unknown>) {
  delete body["reasoning_effort"];
  delete body["reasoning"];
  if (model.startsWith("openai/")) body["reasoning_effort"] = "none";
  else if (model.startsWith("google/")) body["extra_body"] = { google: { thinking_config: { thinking_budget: 0 } } };
  else if (model.startsWith("anthropic/")) delete body["thinking"]; // no thinking object = no extended thinking
  return body;
}

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

/** Streams a model call through Lovable AI. Use `.text` for the final answer or `.toTextStreamResponse()` to stream to the browser.
 *  `model` picks a gateway model (see MODELS); reasoning is always off. */
export function aiStream(
  request: Request,
  system: string,
  user: string,
  opts: { model?: string; imageUrl?: string; onFinish?: (text: string) => Promise<void> | void } = {},
) {
  const model = opts.model ?? MODELS.default;
  console.info(`[ai] ${model}`);
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
      const original = init?.body ?? null;
      let body = original;
      if (typeof original === "string") {
        try { body = JSON.stringify(withoutReasoning(model, JSON.parse(original))); } catch { /* not JSON — send as is */ }
      }
      let res = await fetch(input, { ...init, headers: h, body });
      if (res.status === 400 && body !== original) {
        // Some models reject a reasoning-off field (e.g. a thinking budget of 0): retry once without it.
        console.warn(`[ai] ${model} rejected reasoning-off: ${(await res.text()).slice(0, 200)}`);
        res = await fetch(input, { ...init, headers: h, body: original });
      }
      runId ??= res.headers.get(RUN_ID) ?? undefined;
      return res;
    },
  });
  // ai@^7 rejects system-role messages (InvalidPromptError) — pass the system prompt as `instructions`.
  const messages: ModelMessage[] = [
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
  // Chat Completions works for every provider behind the gateway (the Responses API is OpenAI-only).
  return streamText({
    model: provider.chat(model),
    instructions: system,
    messages,
    onError: ({ error }) => console.error(`AI stream error (${model})`, error),
    abortSignal: request.signal,
    ...(opts.onFinish ? { onFinish: ({ text }: { text: string }) => opts.onFinish!(text) } : {}),
  });
}

export const LANG_NAME: Record<string, string> = { ka: "Georgian", en: "English", ru: "Russian" };

const MAX_AUDIO_BYTES = 13 * 1024 * 1024; // Gemini transcribe caps files at 14 MB

/** Sends one audio chunk to Gemini Transcribe through Lovable AI and returns the full text plus detected language. */
export async function transcribeAudio(
  request: Request,
  file: File,
  languageHint?: string,
): Promise<{ text: string; language: string | null }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured");
  if (!file.size || file.size > MAX_AUDIO_BYTES) throw Object.assign(new Error("Invalid audio file size"), { statusCode: 400 });
  // Gemini rejects video/* parts; MediaRecorder sometimes labels audio-only webm as video/webm.
  let type = file.type || "audio/webm";
  if (type.startsWith("video/")) type = type.replace("video/", "audio/");
  const upload = new File([file], file.name || "chunk.webm", { type });

  const form = new FormData();
  form.append("model", MODELS.transcribe);
  form.append("file", upload, upload.name);
  form.append("response_format", "json");
  form.append("stream", "true");
  if (languageHint) form.append("language", languageHint);

  const res = await fetch(`${GATEWAY}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: form,
    signal: request.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw Object.assign(new Error(err.slice(0, 300) || "Transcription failed"), { statusCode: res.status });
  }

  const { createParser } = await import("eventsource-parser");
  let text = "";
  let language: string | null = null;
  const parser = createParser({
    onEvent: (ev) => {
      try {
        const d = JSON.parse(ev.data) as { type?: string; delta?: string; text?: string; language?: string };
        if (d.type === "transcript.text.delta" && d.delta) text += d.delta;
        if (d.type === "transcript.text.done") {
          if (d.text) text = d.text;
          if (d.language) language = d.language;
        }
      } catch { /* ignore keep-alives */ }
    },
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(dec.decode(value, { stream: true }));
  }
  return { text: text.trim(), language };
}
