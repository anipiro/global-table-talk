import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Maximize, Minimize, Pause, Play, Square } from "lucide-react";
import { useRoom } from "@/lib/useRoom";
import { AgentFeed, Avatar } from "@/components/AgentFeed";
import { NotebookStrip } from "@/components/Notebook";
import { replayDemo, type ReplayControl } from "@/lib/demoScript";
import { useSignedUrls } from "@/lib/useRoom";
import { Shimmer } from "@/components/Photos";
import { isGroupPhoto } from "@/lib/photos";
import type { Photo } from "@/lib/room";

export const Route = createFileRoute("/t/$code_/screen")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: `Table ${params.code.toUpperCase()} on screen — Gamige` },
      { name: "description", content: "Presenter view: live captions, the agents' conversation and the shared notebook, readable from across the room." },
      { property: "og:title", content: "Gamige presenter view" },
      { property: "og:description", content: "Live captions and agent conversation for a laptop or projector." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PresenterView,
});

function PresenterView() {
  const { code } = Route.useParams();
  const { room, members, lines, translations, agentMessages, notebook, photos, captions, status, retryIn, retry } = useRoom(code);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const [full, setFull] = useState(false);
  const [replay, setReplay] = useState<string | null>(null);
  const ctl = useRef<ReplayControl>({ paused: false, speed: 1, cancelled: false });
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const SPEEDS = [0.5, 1, 2];

  // A newly shared photo takes over the right half for 8 seconds.
  const knownPhotos = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<Photo[]>([]);
  useEffect(() => {
    if (status === "loading") return;
    if (!knownPhotos.current) { knownPhotos.current = new Set(photos.map((p) => p.id)); return; }
    const fresh = photos.filter((p) => !knownPhotos.current!.has(p.id));
    fresh.forEach((p) => knownPhotos.current!.add(p.id));
    if (fresh.length) setQueue((q) => [...q, ...fresh]);
  }, [photos, status]);
  const showing = queue[0];
  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 8000);
    return () => clearTimeout(t);
  }, [showing?.id]);
  const capEnd = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && lines.length) seen.current = new Set(lines.map((l) => l.id));

  useEffect(() => capEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [lines.length, translations.length]);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  if (room === undefined) return <main className="flex h-dvh items-center justify-center text-2xl text-muted-foreground">Loading…</main>;
  if (!room) return <main className="flex h-dvh items-center justify-center text-3xl">Table {code.toUpperCase()} not found</main>;

  const visible = members.filter((m) => m.approved);
  async function runReplay() {
    if (replay) return;
    ctl.current = { paused: false, speed, cancelled: false };
    setPaused(false);
    setReplay("Starting…");
    try {
      await replayDemo(room!.id, members, (i, n) => setReplay(`${i}/${n}`), 2000, ctl.current);
    } finally {
      setTimeout(() => setReplay(null), 1500);
    }
  }
  const togglePause = () => { ctl.current.paused = !ctl.current.paused; setPaused(ctl.current.paused); };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
    ctl.current.speed = next;
    setSpeed(next);
  };
  const stopReplay = () => { ctl.current.cancelled = true; };

  return (
    <main className="flex h-dvh flex-col gap-4 overflow-hidden bg-background p-6 text-foreground">
      <header className="flex items-center gap-6">
        <span className="flex items-center gap-3 text-2xl font-semibold">
          <span className="relative flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-destructive" />
          </span>
          live
        </span>
        <span className="font-display text-5xl font-bold tracking-[0.2em]">{room.code}</span>
        <div className="flex -space-x-2">
          {visible.map((m) => (
            <span key={m.id} title={m.name} className="rounded-full ring-4 ring-background"><Avatar member={m} size={48} /></span>
          ))}
        </div>
        <span className="text-xl text-muted-foreground">{visible.map((m) => m.name).join(" · ")}</span>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {replay ? (
            <div className="flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-1 text-muted-foreground" role="group" aria-label="Demo replay">
              <span className="px-1 tabular-nums" aria-live="polite">{paused ? "Paused" : "Replaying"} {replay}</span>
              <button onClick={togglePause} aria-label={paused ? "Resume replay" : "Pause replay"} className="rounded-full p-1.5 hover:text-foreground">
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
              <button onClick={cycleSpeed} aria-label={`Replay speed ${speed}x, change`} className="flex items-center gap-1 rounded-full px-1.5 py-1 tabular-nums hover:text-foreground">
                <Gauge className="h-3.5 w-3.5" /> {speed}×
              </button>
              <button onClick={stopReplay} aria-label="Stop replay" className="rounded-full p-1.5 hover:text-foreground"><Square className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <button onClick={runReplay} aria-label="Replay demo"
              className="flex items-center gap-1 rounded-full bg-secondary/60 px-3 py-1.5 text-muted-foreground hover:text-foreground">
              <Play className="h-3.5 w-3.5" /> Replay demo
            </button>
          )}
          <button aria-label={full ? "Exit fullscreen" : "Fullscreen"} className="rounded-full bg-secondary/60 p-2 text-muted-foreground hover:text-foreground"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
            {full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6">
        <section className="flex min-h-0 flex-col rounded-3xl bg-card/60 p-6">
          <h2 className="mb-4 text-lg uppercase tracking-widest text-muted-foreground">Captions</h2>
          <div className="min-h-0 flex-1 overflow-y-auto pr-2">
            {!lines.length && <p className="text-2xl text-muted-foreground">Waiting for someone to speak…</p>}
            <ul className="flex flex-col gap-6">
              {lines.slice(-40).map((l) => {
                const sp = byId.get(l.speaker_id ?? "");
                const trs = translations.filter((t) => t.line_id === l.id && t.language !== l.language);
                return (
                  <li key={l.id} className={seen.current && !seen.current.has(l.id) ? "animate-msg-in" : ""}>
                    <p className="text-xl font-semibold" style={{ color: sp?.color }}>{sp?.name ?? "Unknown speaker"}</p>
                    <p className="text-[34px] leading-tight">{l.text}</p>
                    {trs.map((t) => <p key={t.id} className="mt-1 text-[28px] leading-snug text-muted-foreground">{t.text}</p>)}
                  </li>
                );
              })}
            </ul>
            <div ref={capEnd} />
          </div>
        </section>

        {showing ? (
          <PhotoTakeover key={showing.id} photo={showing} captions={captions} by={byId.get(showing.uploader_id ?? "")?.name} group={isGroupPhoto(showing.storage_path)} />
        ) : (
          <section className="flex min-h-0 flex-col rounded-3xl bg-card/60 p-6">
            <h2 className="mb-4 text-lg uppercase tracking-widest text-muted-foreground">The agents</h2>
            <div className="min-h-0 flex-1">
              <AgentFeed msgs={agentMessages} byId={byId} large status={status} retryIn={retryIn} onRetry={retry} />
            </div>
          </section>
        )}
      </div>

      <section className="shrink-0">
        <h2 className="mb-2 text-lg uppercase tracking-widest text-muted-foreground">Notebook</h2>
        <NotebookStrip entries={notebook} byId={byId} />
      </section>
    </main>
  );
}

function PhotoTakeover({ photo, captions, by, group }: { photo: Photo; captions: { photo_id: string; language: string; caption: string; description: string }[]; by?: string; group: boolean }) {
  const urls = useSignedUrls([photo.storage_path]);
  const caps = captions.filter((c) => c.photo_id === photo.id);
  const main = caps.find((c) => c.language === "en") ?? caps[0];
  return (
    <section className="animate-takeover flex min-h-0 flex-col gap-4 rounded-3xl bg-card p-6" aria-live="polite">
      <h2 className="text-lg uppercase tracking-widest text-primary">{group ? "Group photo" : `${by ?? "Someone"} shared a photo`}</h2>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-secondary">
        {urls[photo.storage_path] ? <img src={urls[photo.storage_path]} alt={main?.caption ?? "Shared photo"} className="max-h-full max-w-full object-contain" /> : <Shimmer className="h-full w-full" />}
      </div>
      {main ? (
        <div>
          <p className="text-[34px] font-semibold leading-tight">{main.caption}</p>
          {caps.filter((c) => c !== main).map((c) => <p key={c.language} className="text-2xl text-muted-foreground">{c.caption}</p>)}
        </div>
      ) : <div><Shimmer className="h-8 w-2/3" /><Shimmer className="mt-2 h-6 w-1/2" /></div>}
    </section>
  );
}
