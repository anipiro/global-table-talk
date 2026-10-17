import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deviceLabel } from "@/lib/agent";
import { runSpeakerEval, SAMPLES, type SampleResult } from "@/lib/speakers";

export const Route = createFileRoute("/test/speakers")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Speaker accuracy report — Gamige" },
      { name: "description", content: "Labeled overlapping-speech samples scored against Gamige's speaker assignment, tracked over time." },
      { property: "og:title", content: "Speaker accuracy report — Gamige" },
      { property: "og:description", content: "Who-said-what accuracy over time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SpeakerEvalPage,
});

type Run = { id: string; created_at: string; total: number; correct: number; ambiguous_expected: number; ambiguous_caught: number; device: string | null; details: unknown };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function SpeakerEvalPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = () =>
    supabase.from("speaker_eval_runs").select().order("created_at", { ascending: false }).limit(50).then(({ data }) => setRuns((data as Run[]) ?? []));
  useEffect(() => { void load(); }, []);

  async function run() {
    setBusy(true);
    try {
      const r = await runSpeakerEval(deviceLabel());
      toast.success(`Accuracy ${pct(r.correct, r.total)}% (${r.correct}/${r.total})`);
      setOpen(r.id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setBusy(false);
    }
  }

  const chart = [...runs].reverse().slice(-20);
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 text-base">
      <Link to="/" className="text-muted-foreground">← Home</Link>
      <header>
        <h1 className="text-3xl font-bold">Speaker accuracy</h1>
        <p className="mt-1 text-muted-foreground">
          {SAMPLES.length} labeled samples of two people side by side — overheard copies, overlapping replies and near-ties — run through the real
          who-said-what logic. Each run is saved so you can see accuracy change over time.
        </p>
      </header>
      <button onClick={run} disabled={busy} className="rounded-full bg-primary py-4 text-lg font-semibold text-primary-foreground disabled:opacity-50">
        {busy ? "Running samples…" : "Run evaluation"}
      </button>

      {chart.length > 0 && (
        <section className="rounded-3xl bg-card p-4">
          <h2 className="mb-3 font-semibold">Accuracy over time</h2>
          <div className="flex h-32 items-end gap-1" role="img" aria-label="Accuracy per run">
            {chart.map((r) => {
              const a = pct(r.correct, r.total);
              return (
                <div key={r.id} title={`${new Date(r.created_at).toLocaleString()} · ${a}%`} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] text-muted-foreground">{a}</span>
                  <div className={`w-full rounded-t ${a === 100 ? "bg-primary" : "bg-destructive"}`} style={{ height: `${Math.max(4, a)}%` }} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Runs</h2>
        {!runs.length && <p className="text-muted-foreground">No runs yet.</p>}
        {runs.map((r, i) => {
          const prev = runs[i + 1];
          const a = pct(r.correct, r.total);
          const delta = prev ? a - pct(prev.correct, prev.total) : 0;
          return (
            <div key={r.id} className="rounded-2xl bg-card p-3">
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 text-left">
                <span className={`text-2xl font-bold ${a === 100 ? "text-primary" : "text-destructive"}`}>{a}%</span>
                <span className="flex-1 text-sm">
                  {r.correct}/{r.total} utterances right · unsure flag {r.ambiguous_caught}/{r.ambiguous_expected}
                  <br /><span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()} · {r.device}</span>
                </span>
                {prev && delta !== 0 && <span className={`text-sm ${delta > 0 ? "text-primary" : "text-destructive"}`}>{delta > 0 ? "+" : ""}{delta}</span>}
              </button>
              {open === r.id && (
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {(r.details as SampleResult[]).map((s) => (
                    <li key={s.id} className="rounded-xl bg-secondary p-2">
                      <p className="font-semibold">{s.label}</p>
                      {s.utterances.map((u) => (
                        <p key={u.utt} className={u.correct ? "" : "text-destructive"}>
                          {u.correct ? "✓" : "✗"} said by {u.truth} → kept as {u.predicted.length ? u.predicted.join(" + ") : "nothing"}
                          {u.ambiguousExpected && <> · unsure flag {u.ambiguous ? "✓" : "✗ missing"}</>}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
