import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Download, Keyboard, Pause, Play, SkipBack, SkipForward, Undo2, Volume2, VolumeX, Headphones, HelpCircle, X } from "lucide-react";
import { getMemberId, type Lang, type Line } from "@/lib/room";
import { useRoom } from "@/lib/useRoom";
import { findOverlaps } from "@/lib/crosstalk";
import { activeAt, audibleLanes, schedule, scrubTarget, transcriptCsv, transcriptText, type ExportRow } from "@/lib/overlap";
import { applyReassign, ReassignSheet } from "@/components/Reassign";
import { undoCorrection } from "@/lib/speakers";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/overlap/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Who said what — Gamige" },
      { name: "description", content: "Review overlapping speech in speaker lanes, replay it, and fix who said what." },
      { property: "og:title", content: "Who said what — Gamige" },
      { property: "og:description", content: "Speaker lanes for reviewing mixed dialogue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OverlapPage,
});

const PX_PER_MS = 0.045; // 45px per second
const MAX_GAP_MS = 4000;
const VOICE: Record<string, string> = { ka: "ka-GE", en: "en-US", ru: "ru-RU" };
const fmtSec = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Scrub to previous / next segment"],
  ["↑ / ↓", "Switch speaker lane"],
  ["Enter", "Move selected segment to the highlighted lane"],
  ["S", "Solo the highlighted lane"],
  ["M", "Mute / unmute the highlighted lane"],
  ["U", "Undo the last correction"],
  ["?", "Show / hide this guide"],
];

function OverlapPage() {
  const { code } = Route.useParams();
  const { room, members, lines, corrections, translations } = useRoom(code);
  const me = members.find((m) => m.id === getMemberId(code));
  const lanes = useMemo(() => {
    const ls = members.filter((m) => m.approved || lines.some((l) => l.speaker_id === m.id));
    // Lines nobody could be sure about get their own lane instead of landing on a person.
    if (lines.some((l) => !l.speaker_id)) ls.push({ id: "", name: "Unknown speaker", color: "#8a8178" } as (typeof members)[number]);
    return ls;
  }, [members, lines]);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const overlaps = useMemo(() => findOverlaps(lines), [lines]);

  const [speed, setSpeed] = useState(1);
  const plan = useMemo(() => schedule(lines, 1, MAX_GAP_MS), [lines]);
  const [pos, setPos] = useState(0); // ms on the plan timeline (speed 1)
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<string | null>(null);
  const [laneIdx, setLaneIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [fixLine, setFixLine] = useState<Line | null>(null);
  const [guide, setGuide] = useState(false);
  const [onlyMixed, setOnlyMixed] = useState(false);

  const audible = useMemo(() => audibleLanes(lanes.map((l) => l.id), muted, solo), [lanes, muted, solo]);
  const active = useMemo(() => activeAt(plan, pos), [plan, pos]);
  const playingLanes = useMemo(() => new Set(plan.filter((p) => active.has(p.seg.id)).map((p) => p.seg.speaker_id ?? "")), [plan, active]);
  const focusLane = lanes[Math.min(laneIdx, Math.max(0, lanes.length - 1))];

  // Playback clock: advances `pos` in real time × speed; speaks each segment as its timestamp is crossed.
  const nextIdx = useRef(0);
  const audibleRef = useRef(audible);
  audibleRef.current = audible;
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => {
    if (!playing) { speechSynthesis?.cancel(); return; }
    nextIdx.current = plan.findIndex((p) => p.at >= posRef.current - 1);
    if (nextIdx.current < 0) nextIdx.current = plan.length;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = posRef.current + (now - last) * speed;
      last = now;
      while (nextIdx.current < plan.length && plan[nextIdx.current]!.at <= p) {
        const { seg } = plan[nextIdx.current]!;
        nextIdx.current++;
        setSelected(seg.id);
        if (audibleRef.current.has(seg.speaker_id ?? "") && typeof speechSynthesis !== "undefined") {
          // The phone voice speaks one line at a time; a line that starts while another is playing cuts in,
          // so every segment still starts at its real moment.
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(seg.text);
          u.lang = VOICE[(seg as Line).language as Lang] ?? "en-US";
          u.rate = Math.min(2, 1.05 * speed);
          speechSynthesis.speak(u);
        }
      }
      const end = plan.length ? plan[plan.length - 1]!.at + 2500 : 0;
      if (p >= end) { setPos(end); setPlaying(false); return; }
      setPos(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, plan, speed]);

  const scrub = useCallback((dir: 1 | -1) => {
    const t = scrubTarget(plan, posRef.current, dir);
    setPos(t);
    const hit = plan.find((p) => p.at === t);
    if (hit) setSelected(hit.seg.id);
    if (playing) { setPlaying(false); setTimeout(() => setPlaying(true), 0); }
  }, [plan, playing]);

  const toggleMute = (id: string) => setMuted((m) => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSolo = (id: string) => setSolo((s) => (s === id ? null : id));
  const lastCorrection = corrections.filter((c) => !c.undone_at).slice(-1)[0];
  const undo = (id: string) => undoCorrection(id).then((n) => toast(`Undone. ${n} line${n === 1 ? "" : "s"} restored.`)).catch(() => toast.error("Couldn't undo"));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (k === "ArrowRight") { e.preventDefault(); scrub(1); }
      else if (k === "ArrowLeft") { e.preventDefault(); scrub(-1); }
      else if (k === "ArrowDown") { e.preventDefault(); setLaneIdx((i) => Math.min(lanes.length - 1, i + 1)); }
      else if (k === "ArrowUp") { e.preventDefault(); setLaneIdx((i) => Math.max(0, i - 1)); }
      else if (k === "Enter") {
        const l = lines.find((x) => x.id === selected);
        if (l && focusLane?.id && (l.speaker_id !== focusLane.id || l.ambiguous)) void applyReassign(l, focusLane, me);
      }
      else if (k === "s" || k === "S") { if (focusLane) toggleSolo(focusLane.id); }
      else if (k === "m" || k === "M") { if (focusLane) toggleMute(focusLane.id); }
      else if (k === "u" || k === "U") { if (lastCorrection) void undo(lastCorrection.id); }
      else if (k === "?") setGuide((g) => !g);
      else if (k === "Escape") { setGuide(false); setFixLine(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // keep the playhead in view
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing || !scroller.current) return;
    const y = pos * PX_PER_MS;
    const el = scroller.current;
    if (y < el.scrollTop + 40 || y > el.scrollTop + el.clientHeight - 120) el.scrollTo({ top: Math.max(0, y - 80), behavior: "smooth" });
  }, [pos, playing]);

  function exportAs(kind: "csv" | "txt") {
    const corrected = new Set(corrections.filter((c) => !c.undone_at).flatMap((c) => ((c.changes as { line_id: string }[]) ?? []).map((x) => x.line_id)));
    const rows: ExportRow[] = plan.map(({ seg }) => {
      const l = seg as Line;
      const tr = me && l.language !== me.language ? translations.find((t) => t.line_id === l.id && t.language === me.language)?.text : undefined;
      return { at: l.created_at, speaker: byId.get(l.speaker_id ?? "")?.name ?? "Unknown speaker", language: l.language, text: l.text, translation: tr,
        unsure: l.ambiguous, overlap: overlaps.has(l.id), corrected: corrected.has(l.id) };
    });
    const body = kind === "csv" ? transcriptCsv(rows) : transcriptText(rows, fmtSec);
    const blob = new Blob([kind === "csv" ? "\uFEFF" + body : body], { type: kind === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gamige-${room?.code ?? code}-transcript.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const shown = plan.filter((p) => !onlyMixed || overlaps.has(p.seg.id) || p.seg.ambiguous);
  const height = (plan.length ? plan[plan.length - 1]!.at : 0) * PX_PER_MS + 160;
  const laneW = `${100 / Math.max(1, lanes.length)}%`;

  return (
    <main className="flex h-dvh flex-col text-base">
      <header className="flex flex-col gap-2 border-b bg-background px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <Link to="/room/$code" params={{ code }} className="-ml-2 flex min-h-11 items-center gap-1 px-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden /> Back to live
          </Link>
          <h1 className="text-lg font-semibold">Who said what</h1>
          <Button variant="secondary" size="sm" onClick={() => setGuide(true)} aria-label="Keyboard shortcuts" className="px-3">
            <Keyboard aria-hidden /> <span className="hidden sm:inline">Shortcuts</span> <kbd className="rounded-sm bg-background px-1 text-sm">?</kbd>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="icon" className="[&_svg]:size-5" onClick={() => scrub(-1)} aria-label="Previous segment"><SkipBack /></Button>
          <Button size="icon" className="size-12 [&_svg]:size-6" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} disabled={!plan.length}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button variant="secondary" size="icon" className="[&_svg]:size-5" onClick={() => scrub(1)} aria-label="Next segment"><SkipForward /></Button>
          <Button variant="secondary" className="min-w-14 px-3" onClick={() => setSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1))}>{speed}×</Button>
          <input type="range" min={0} max={plan.length ? plan[plan.length - 1]!.at : 0} value={pos} step={100} aria-label="Playback position"
            onChange={(e) => { setPos(Number(e.target.value)); if (playing) { setPlaying(false); setTimeout(() => setPlaying(true), 0); } }}
            className="h-11 min-w-24 flex-1 accent-[var(--primary)]" />
          <Button variant={onlyMixed ? "default" : "secondary"} onClick={() => setOnlyMixed((v) => !v)} aria-pressed={onlyMixed}>Only overlaps</Button>
        </div>
        <p className="text-sm text-muted-foreground">Playback reads captions aloud with the phone's voice (no recordings are kept). Lines start at their real moments; overlapping lines cut in.</p>
      </header>

      {/* lane headers */}
      <div className="flex border-b">
        <div className="w-16 shrink-0" />
        {lanes.map((m, i) => {
          const isSolo = solo === m.id, isMuted = muted.has(m.id) && !isSolo, isPlaying = playing && playingLanes.has(m.id), isFocus = focusLane?.id === m.id;
          return (
            <div key={m.id} style={{ width: laneW }}
              onClick={() => setLaneIdx(i)}
              data-state={isPlaying ? "playing" : isSolo ? "solo" : "idle"}
              className={`flex min-w-0 flex-col items-center gap-1 border-l px-1 py-2 ${isPlaying ? "bg-accent" : isSolo ? "bg-secondary" : ""} ${isFocus ? "ring-2 ring-inset ring-primary" : ""} ${isMuted || (solo && !isSolo) ? "opacity-60" : ""}`}>
              <span className="speaker-ink flex max-w-full items-center gap-1 truncate font-semibold" style={{ "--speaker": m.color } as React.CSSProperties}>
                {isPlaying && <Volume2 className="size-4 shrink-0 animate-pulse" aria-hidden />}{m.name}
              </span>
              <div className="flex flex-wrap justify-center gap-1">
                <button onClick={(e) => { e.stopPropagation(); toggleSolo(m.id); }} aria-pressed={isSolo} aria-label={`Solo ${m.name}`}
                  className={`flex size-11 items-center justify-center rounded-md text-sm font-bold ${isSolo ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>S</button>
                <button onClick={(e) => { e.stopPropagation(); toggleMute(m.id); }} aria-pressed={muted.has(m.id)} aria-label={`Mute ${m.name}`}
                  className={`flex size-11 items-center justify-center rounded-md ${muted.has(m.id) ? "bg-destructive text-destructive-foreground" : "bg-secondary"}`}>
                  {muted.has(m.id) ? <VolumeX className="size-4" aria-hidden /> : <Headphones className="size-4" aria-hidden />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* timeline */}
      <div ref={scroller} className="relative flex-1 overflow-y-auto">
        {!lines.length && <p className="p-10 text-center text-muted-foreground">Nothing has been said yet.</p>}
        <div className="relative" style={{ height }}>
          {/* playhead */}
          <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-primary" style={{ top: pos * PX_PER_MS + 8 }} />
          {shown.map(({ seg, at }) => {
            const l = seg as Line;
            const lane = lanes.findIndex((m) => m.id === (l.speaker_id ?? ""));
            const sp = byId.get(l.speaker_id ?? "");
            const isActive = active.has(l.id), isSel = selected === l.id, isOverlap = overlaps.has(l.id);
            const laneAudible = audible.has(l.speaker_id ?? "");
            return (
              <div key={l.id} className="pointer-events-none absolute inset-x-0 flex" style={{ top: at * PX_PER_MS + 8 }}>
                <span className="w-16 shrink-0 px-1 pt-1 text-xs tabular-nums text-muted-foreground">{fmtSec(l.created_at)}</span>
                <div className="relative flex-1">
                  <button
                    onClick={() => { setSelected(l.id); setPos(at); if (lane >= 0) setLaneIdx(lane); }}
                    onDoubleClick={() => setFixLine(l)}
                    data-active={isActive || undefined}
                    className={`pointer-events-auto absolute rounded-md border bg-card p-2 text-left text-sm
                      ${isActive ? "border-primary bg-secondary" : ""} ${isSel ? "ring-2 ring-primary" : ""}
                      ${isOverlap ? "border-dashed" : ""} ${!laneAudible ? "opacity-60" : ""}`}
                    style={{ left: `calc(${laneW} * ${Math.max(0, lane)} + 2px)`, width: `calc(${laneW} - 4px)`, borderLeftColor: sp?.color, borderLeftWidth: 3 }}
                  >
                    {(l.ambiguous || isOverlap) && (
                      <span className="mb-1 flex flex-wrap gap-x-2 text-xs">
                        {isOverlap && <span className="text-muted-foreground">overlap</span>}
                        {l.ambiguous && <span className="text-primary">unsure speaker</span>}
                      </span>
                    )}
                    <span lang={l.language}>{l.text}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* selected segment actions + corrections history */}
      <footer className="max-h-[38dvh] overflow-y-auto border-t bg-card px-3 py-3">
        {selected && lines.find((l) => l.id === selected) && (
          <div className="mb-3 flex items-center gap-2">
            <p className="flex-1 truncate text-sm">“{lines.find((l) => l.id === selected)!.text}”</p>
            <Button size="sm" onClick={() => setFixLine(lines.find((l) => l.id === selected)!)}>
              <HelpCircle aria-hidden /> Who said this?
            </Button>
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-muted-foreground">Export transcript</span>
          <Button variant="secondary" size="sm" onClick={() => exportAs("csv")} disabled={!lines.length}><Download aria-hidden /> Spreadsheet (CSV)</Button>
          <Button variant="secondary" size="sm" onClick={() => exportAs("txt")} disabled={!lines.length}><Download aria-hidden /> Text</Button>
        </div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Speaker corrections</h2>
        {!corrections.length && <p className="text-sm text-muted-foreground">None yet. Fixes you make show up here and can be undone.</p>}
        <ul className="flex flex-col gap-2">
          {[...corrections].reverse().map((c) => {
            const changes = (c.changes as { line_id: string; from_speaker_id: string | null }[]) ?? [];
            const from = [...new Set(changes.map((x) => byId.get(x.from_speaker_id ?? "")?.name ?? "Unknown speaker"))].join(", ");
            const first = lines.find((l) => l.id === c.line_id);
            return (
              <li key={c.id} className={`flex items-center gap-2 rounded-md border p-2 pl-3 text-sm ${c.undone_at ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p><b>{from}</b> → <b className="speaker-ink" style={{ "--speaker": byId.get(c.to_speaker_id ?? "")?.color } as React.CSSProperties}>{byId.get(c.to_speaker_id ?? "")?.name ?? "?"}</b>
                    {" · "}{changes.length} line{changes.length === 1 ? "" : "s"}{changes.length > 1 ? " (incl. nearby)" : ""}
                    {c.by_member_id && <> · by {byId.get(c.by_member_id)?.name ?? "someone"}</>}
                  </p>
                  {first && <p className="truncate text-muted-foreground">“{first.text}”</p>}
                </div>
                {c.undone_at ? <span className="text-sm">undone</span> : (
                  <Button variant="outline" size="sm" onClick={() => void undo(c.id)} aria-label="Undo correction">
                    <Undo2 aria-hidden /> Undo
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </footer>

      {fixLine && <ReassignSheet line={fixLine} members={members} me={me} onClose={() => setFixLine(null)} />}

      {guide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={() => setGuide(false)}>
          <div role="dialog" aria-label="Keyboard shortcuts" className="w-full max-w-sm rounded-lg border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Keyboard shortcuts</h2>
              <button onClick={() => setGuide(false)} aria-label="Close" className="-mr-2 flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-5" /></button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="contents">
                  <dt><kbd className="rounded-md border bg-secondary px-2 py-0.5 font-mono text-sm">{k}</kbd></dt>
                  <dd className="text-sm">{d}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">On a phone: tap a segment to select it, double-tap or use “Who said this?” to move it.</p>
          </div>
        </div>
      )}
    </main>
  );
}

