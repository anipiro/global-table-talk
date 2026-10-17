import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Keyboard, Pause, Play, SkipBack, SkipForward, Undo2, Volume2, VolumeX, Headphones, HelpCircle, X } from "lucide-react";
import { getMemberId, type Lang, type Line } from "@/lib/room";
import { useRoom } from "@/lib/useRoom";
import { findOverlaps } from "@/lib/crosstalk";
import { activeAt, audibleLanes, schedule, scrubTarget } from "@/lib/overlap";
import { applyReassign, ReassignSheet } from "@/components/Reassign";
import { undoCorrection } from "@/lib/speakers";

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
  const { members, lines, corrections } = useRoom(code);
  const me = members.find((m) => m.id === getMemberId(code));
  const lanes = useMemo(() => members.filter((m) => m.approved || lines.some((l) => l.speaker_id === m.id)), [members, lines]);
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
  const undo = (id: string) => undoCorrection(id).then((n) => toast(`Undone — ${n} line${n === 1 ? "" : "s"} restored`)).catch(() => toast.error("Couldn't undo"));

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
        if (l && focusLane && (l.speaker_id !== focusLane.id || l.ambiguous)) void applyReassign(l, focusLane, me);
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

  const shown = plan.filter((p) => !onlyMixed || overlaps.has(p.seg.id) || p.seg.ambiguous);
  const height = (plan.length ? plan[plan.length - 1]!.at : 0) * PX_PER_MS + 160;
  const laneW = `${100 / Math.max(1, lanes.length)}%`;

  return (
    <main className="flex h-dvh flex-col text-base">
      <header className="flex flex-col gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <Link to="/room/$code" params={{ code }} className="text-muted-foreground">← Back to live</Link>
          <h1 className="text-lg font-semibold">Who said what</h1>
          <button onClick={() => setGuide(true)} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-sm" aria-label="Keyboard shortcuts">
            <Keyboard className="h-4 w-4" /> <span className="hidden sm:inline">Shortcuts</span> <kbd className="rounded bg-background px-1 text-xs">?</kbd>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => scrub(-1)} aria-label="Previous segment" className="rounded-full bg-secondary p-2"><SkipBack className="h-5 w-5" /></button>
          <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} disabled={!plan.length}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
            {playing ? <Pause /> : <Play />}
          </button>
          <button onClick={() => scrub(1)} aria-label="Next segment" className="rounded-full bg-secondary p-2"><SkipForward className="h-5 w-5" /></button>
          <button onClick={() => setSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1))} className="rounded-full bg-secondary px-3 py-2 text-sm font-semibold">{speed}×</button>
          <input type="range" min={0} max={plan.length ? plan[plan.length - 1]!.at : 0} value={pos} step={100} aria-label="Playback position"
            onChange={(e) => { setPos(Number(e.target.value)); if (playing) { setPlaying(false); setTimeout(() => setPlaying(true), 0); } }}
            className="min-w-24 flex-1 accent-[var(--primary)]" />
          <button onClick={() => setOnlyMixed((v) => !v)} aria-pressed={onlyMixed}
            className={`rounded-full px-3 py-2 text-sm ${onlyMixed ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>Only overlaps</button>
        </div>
        <p className="text-xs text-muted-foreground">Playback reads captions aloud with the phone's voice (no recordings are kept). Lines start at their real moments; overlapping lines cut in.</p>
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
              className={`flex min-w-0 flex-col items-center gap-1 border-l px-1 py-2 transition ${isPlaying ? "bg-primary/20" : isSolo ? "bg-primary/10" : ""} ${isFocus ? "ring-2 ring-inset ring-primary" : ""} ${isMuted || (solo && !isSolo) ? "opacity-50" : ""}`}>
              <span className="flex max-w-full items-center gap-1 truncate font-semibold" style={{ color: m.color }}>
                {isPlaying && <Volume2 className="h-4 w-4 shrink-0 animate-pulse" />}{m.name}
              </span>
              <div className="flex gap-1">
                <button onClick={(e) => { e.stopPropagation(); toggleSolo(m.id); }} aria-pressed={isSolo} aria-label={`Solo ${m.name}`}
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${isSolo ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>S</button>
                <button onClick={(e) => { e.stopPropagation(); toggleMute(m.id); }} aria-pressed={muted.has(m.id)} aria-label={`Mute ${m.name}`}
                  className={`rounded-full px-2 py-0.5 text-xs ${muted.has(m.id) ? "bg-destructive text-destructive-foreground" : "bg-secondary"}`}>
                  {muted.has(m.id) ? <VolumeX className="h-3.5 w-3.5" /> : <Headphones className="h-3.5 w-3.5" />}
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
            const lane = lanes.findIndex((m) => m.id === l.speaker_id);
            const sp = byId.get(l.speaker_id ?? "");
            const isActive = active.has(l.id), isSel = selected === l.id, isOverlap = overlaps.has(l.id);
            const laneAudible = audible.has(l.speaker_id ?? "");
            return (
              <div key={l.id} className="absolute inset-x-0 flex" style={{ top: at * PX_PER_MS + 8 }}>
                <span className="w-16 shrink-0 px-1 pt-1 text-[11px] tabular-nums text-muted-foreground">{fmtSec(l.created_at)}</span>
                <div className="relative flex-1">
                  <button
                    onClick={() => { setSelected(l.id); setPos(at); if (lane >= 0) setLaneIdx(lane); }}
                    onDoubleClick={() => setFixLine(l)}
                    data-active={isActive || undefined}
                    className={`absolute rounded-2xl border bg-card p-2 text-left text-sm leading-snug shadow-sm transition
                      ${isActive ? "border-primary bg-primary/15 scale-[1.02]" : ""} ${isSel ? "ring-2 ring-primary" : ""}
                      ${isOverlap ? "border-dashed" : ""} ${!laneAudible ? "opacity-50" : ""}`}
                    style={{ left: `calc(${laneW} * ${Math.max(0, lane)} + 2px)`, width: `calc(${laneW} - 4px)`, borderLeftColor: sp?.color, borderLeftWidth: 4 }}
                  >
                    {(l.ambiguous || isOverlap) && (
                      <span className="mb-1 flex flex-wrap gap-1 text-[10px]">
                        {isOverlap && <span className="rounded-full bg-secondary px-1.5">overlap</span>}
                        {l.ambiguous && <span className="rounded-full border border-primary/60 px-1.5 text-primary">unsure speaker</span>}
                      </span>
                    )}
                    {l.text}
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
            <button onClick={() => setFixLine(lines.find((l) => l.id === selected)!)} className="flex items-center gap-1 rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
              <HelpCircle className="h-4 w-4" /> Who said this?
            </button>
          </div>
        )}
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Speaker corrections</h2>
        {!corrections.length && <p className="text-sm text-muted-foreground">None yet. Fixes you make show up here and can be undone.</p>}
        <ul className="flex flex-col gap-2">
          {[...corrections].reverse().map((c) => {
            const changes = (c.changes as { line_id: string; from_speaker_id: string | null }[]) ?? [];
            const from = [...new Set(changes.map((x) => byId.get(x.from_speaker_id ?? "")?.name ?? "Someone"))].join(", ");
            const first = lines.find((l) => l.id === c.line_id);
            return (
              <li key={c.id} className={`flex items-center gap-2 rounded-2xl bg-secondary p-2 text-sm ${c.undone_at ? "opacity-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p><b>{from}</b> → <b style={{ color: byId.get(c.to_speaker_id ?? "")?.color }}>{byId.get(c.to_speaker_id ?? "")?.name ?? "?"}</b>
                    {" · "}{changes.length} line{changes.length === 1 ? "" : "s"}{changes.length > 1 ? " (incl. nearby)" : ""}
                    {c.by_member_id && <> · by {byId.get(c.by_member_id)?.name ?? "someone"}</>}
                  </p>
                  {first && <p className="truncate text-muted-foreground">“{first.text}”</p>}
                </div>
                {c.undone_at ? <span className="text-xs">undone</span> : (
                  <button onClick={() => void undo(c.id)} className="flex items-center gap-1 rounded-full bg-background px-3 py-1.5" aria-label="Undo correction">
                    <Undo2 className="h-4 w-4" /> Undo
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </footer>

      {fixLine && <ReassignSheet line={fixLine} members={members} me={me} onClose={() => setFixLine(null)} />}

      {guide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" onClick={() => setGuide(false)}>
          <div role="dialog" aria-label="Keyboard shortcuts" className="w-full max-w-sm rounded-3xl border bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Keyboard shortcuts</h2>
              <button onClick={() => setGuide(false)} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="contents">
                  <dt><kbd className="rounded-lg border bg-secondary px-2 py-0.5 font-mono text-sm">{k}</kbd></dt>
                  <dd className="text-sm">{d}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">On a phone: tap a segment to select it, double-tap or use “Who said this?” to move it.</p>
          </div>
        </div>
      )}
    </main>
  );
}

