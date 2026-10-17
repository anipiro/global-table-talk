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
    instructions: system,
    messages,
    onError: ({ error }) => console.error("AI stream error", error),
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
    ...(opts.onFinish ? { onFinish: ({ text }: { text: string }) => opts.onFinish!(text) } : {}),
  });
}

export const LANG_NAME: Record<string, string> = { ka: "Georgian", en: "English", ru: "Russian" };

const TRANSCRIBE_MODEL = "google/gemini-3.5-transcribe";
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
  form.append("model", TRANSCRIBE_MODEL);
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
