import { aiStream, MODELS } from "@/lib/ai.server";

/** Health check: one tiny real call per configured model, in parallel. Costs 4 very short calls — run it
 *  once after each back-end push, not in a loop. */
const CHECKS = ["trigger", "translate", "agent", "recap"] as const;
const TIMEOUT_MS = 20_000;

type Check = { task: (typeof CHECKS)[number]; model: string; ok: boolean; ms: number; reply?: string; error?: string };

async function check(request: Request, task: Check["task"]): Promise<Check> {
  const model = MODELS[task];
  const t0 = Date.now();
  try {
    const r = aiStream(request, "You are a health check. Reply with the single word OK.", "ping", { model });
    // Read the full stream so a provider error surfaces with its message instead of an empty `.text`.
    const read = async () => {
      let out = "";
      for await (const part of r.fullStream) {
        if (part.type === "text-delta") out += part.text;
        if (part.type === "error") throw part.error;
      }
      return out;
    };
    const text = await Promise.race([
      read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)),
    ]);
    const reply = text.trim().slice(0, 40);
    if (!reply) return { task, model, ok: false, ms: Date.now() - t0, error: "empty reply" };
    return { task, model, ok: true, ms: Date.now() - t0, reply };
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    const msg = e instanceof Error ? e.message : String(e);
    const detail = (e as { responseBody?: string })?.responseBody;
    const error = `${status ? `${status}: ` : ""}${msg}${detail ? ` — ${detail}` : ""}`.slice(0, 400);
    return { task, model, ok: false, ms: Date.now() - t0, error };
  }
}

export async function runHealth(request: Request) {
  const checks = await Promise.all(CHECKS.map((t) => check(request, t)));
  return { ok: checks.every((c) => c.ok), checks };
}
