import { aiStream, generateImage, IMAGE, MODELS } from "@/lib/ai.server";

/** Health check: one tiny real call per configured model, in parallel. Costs 4 very short calls — run it
 *  once after each back-end push, not in a loop. Plus one low-quality test image (generated, not stored);
 *  pass ?images=0 (or "images": false) to skip it. */
const CHECKS = ["trigger", "translate", "agent", "recap"] as const;
const TIMEOUT_MS = 20_000;

type Check = { task: (typeof CHECKS)[number] | "image"; model: string; ok: boolean; ms: number; reply?: string; error?: string };

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

async function checkImage(request: Request): Promise<Check> {
  const t0 = Date.now();
  try {
    const img = await generateImage(request, "A single ripe red apple on a plain white table. No text.", IMAGE.health);
    return { task: "image", model: MODELS.image, ok: img.bytes.length > 1000, ms: Date.now() - t0, reply: `${img.contentType}, ${Math.round(img.bytes.length / 1024)} KB` };
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    const msg = e instanceof Error ? e.message : String(e);
    return { task: "image", model: MODELS.image, ok: false, ms: Date.now() - t0, error: `${status ? `${status}: ` : ""}${msg}`.slice(0, 400) };
  }
}

export async function runHealth(request: Request, images = true) {
  const checks = await Promise.all([...CHECKS.map((t) => check(request, t)), ...(images ? [checkImage(request)] : [])]);
  return { ok: checks.every((c) => c.ok), checks };
}
