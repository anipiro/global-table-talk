import { useEffect, useMemo, useState } from "react";
import type { Line, Member } from "@/lib/room";
import { watchDecisions, type Decision } from "@/lib/agent";
import { delayStats, KNOWN_SPEAKER_CONFIDENCE } from "@/lib/crosstalk";

const sec = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
const pctTxt = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);

function ConfBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const low = value < KNOWN_SPEAKER_CONFIDENCE;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-background">
        <span className={`block h-full ${low ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="tabular-nums">{pctTxt(value)}</span>
    </span>
  );
}

/** Capture-to-caption delay and speaker-attribution confidence, table-wide and for this phone. */
export function Diagnostics({ lines, members }: { lines: Line[]; members: Member[] }) {
  const [mine, setMine] = useState<Decision[]>([]);
  useEffect(() => { watchDecisions(setMine); return () => watchDecisions(null); }, []);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const measured = lines.filter((l) => l.delay_ms != null || l.confidence != null);

  const perSpeaker = useMemo(() => {
    const groups = new Map<string, Line[]>();
    for (const l of measured) {
      const k = l.speaker_id ?? "unknown";
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    return [...groups.entries()].map(([k, ls]) => {
      const conf = ls.map((l) => l.confidence).filter((x): x is number => x != null);
      return {
        key: k,
        name: k === "unknown" ? "Unknown speaker" : byId.get(k)?.name ?? "?",
        color: k === "unknown" ? undefined : byId.get(k)?.color,
        count: ls.length,
        delay: delayStats(ls.map((l) => l.delay_ms).filter((x): x is number => x != null)),
        conf: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null,
      };
    });
  }, [measured, byId]);

  const all = delayStats(measured.map((l) => l.delay_ms).filter((x): x is number => x != null));
  const unknown = measured.filter((l) => !l.speaker_id).length;
  const dropped = mine.filter((d) => d.outcome === "dropped").length;

  return (
    <div className="flex flex-col gap-5 pt-2 text-sm">
      <section className="grid grid-cols-3 gap-2">
        <Stat label="Delay (median)" value={sec(all?.median)} />
        <Stat label="Delay (slowest 10%)" value={sec(all?.p90)} />
        <Stat label="Unknown speaker" value={measured.length ? `${unknown}/${measured.length}` : "—"} />
      </section>
      <p className="text-xs text-muted-foreground">
        Delay = from the moment someone stops talking to the caption being saved. Confidence below {pctTxt(KNOWN_SPEAKER_CONFIDENCE)} shows as "Unknown speaker".
      </p>

      <section>
        <h3 className="mb-2 font-semibold">By speaker</h3>
        {!perSpeaker.length && <p className="text-muted-foreground">No measured captions yet — turn the mic on and talk.</p>}
        <ul className="flex flex-col gap-1">
          {perSpeaker.map((s) => (
            <li key={s.key} className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2">
              <span className="flex-1 font-semibold" style={{ color: s.color }}>{s.name}</span>
              <span className="text-muted-foreground">{s.count} lines</span>
              <span className="tabular-nums">{sec(s.delay?.median)}</span>
              <ConfBar value={s.conf} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Latest captions</h3>
        <ul className="flex flex-col gap-1">
          {[...measured].reverse().slice(0, 12).map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2">
              <span className="w-24 shrink-0 truncate font-semibold" style={{ color: byId.get(l.speaker_id ?? "")?.color }}>
                {byId.get(l.speaker_id ?? "")?.name ?? "Unknown"}
              </span>
              <span className="min-w-0 flex-1 truncate">{l.text}</span>
              <span className="tabular-nums">{sec(l.delay_ms)}</span>
              <ConfBar value={l.confidence} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">This phone's decisions <span className="font-normal text-muted-foreground">· {dropped} ignored</span></h3>
        {!mine.length && <p className="text-muted-foreground">Nothing heard yet on this phone.</p>}
        <ul className="flex flex-col gap-1">
          {[...mine].reverse().slice(0, 15).map((d) => (
            <li key={d.at + d.text} className="rounded-xl bg-secondary px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 text-xs font-semibold ${d.outcome === "kept" ? "bg-primary text-primary-foreground" : d.outcome === "unknown" ? "border border-primary/60 text-primary" : "bg-destructive/30"}`}>
                  {d.outcome === "kept" ? "yours" : d.outcome === "unknown" ? "unknown" : "ignored"}
                </span>
                <span className="flex-1 truncate">{d.text || d.reason}</span>
                <span className="tabular-nums">{sec(d.delayMs)}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {d.reason} · level {d.level.toFixed(3)}{d.ref ? ` vs your voice ${d.ref.toFixed(3)}` : ""} · loudest here {pctTxt(d.share)} · confidence {pctTxt(d.confidence)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary p-3 text-center">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
