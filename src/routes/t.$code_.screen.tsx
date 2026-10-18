import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Maximize, Minimize, Pause, Play, Square } from "lucide-react";
import { useRoom } from "@/lib/useRoom";
import { Button } from "@/components/ui/button";
import { AgentFeed, Avatar } from "@/components/AgentFeed";
import { NotebookStrip } from "@/components/Notebook";
import { replayDemo, type ReplayControl } from "@/lib/demoScript";
import { useSignedUrls } from "@/lib/useRoom";
import { Shimmer } from "@/components/Photos";
import { isGroupPhoto } from "@/lib/photos";
import { MediaCard } from "@/components/Media";
import { PollTakeover, settlePoll } from "@/components/Polls";
import type { AgentMessage, Media, Member, Photo } from "@/lib/room";
import { Confetti, ConnectionWeb, TableAvatar, useTableLife, useVoiceLevels } from "@/components/TableLife";

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
  const { room, members, lines, translations, agentMessages, notebook, photos, captions, media, polls, pollVotes, cards, status, retryIn, retry } = useRoom(code);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const [full, setFull] = useState(false);
  const [replay, setReplay] = useState<string | null>(null);
  const ctl = useRef<ReplayControl>({ paused: false, speed: 1, cancelled: false });
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const SPEEDS = [0.5, 1, 2];
  const life = useTableLife({ roomId: room?.id, status, members, lines, agentMessages, notebook, media, cards, polls });
  useVoiceLevels(room?.id);

  // A newly shared photo takes over the right half for 8 seconds; a new media item for 6.
  const knownPhotos = useRef<Set<string> | null>(null);
  const knownMedia = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<({ kind: "photo"; photo: Photo } | { kind: "media"; media: Media })[]>([]);
  useEffect(() => {
    if (status === "loading") return;
    if (!knownPhotos.current) { knownPhotos.current = new Set(photos.map((p) => p.id)); return; }
    const fresh = photos.filter((p) => !knownPhotos.current!.has(p.id));
    fresh.forEach((p) => knownPhotos.current!.add(p.id));
    if (fresh.length) setQueue((q) => [...q, ...fresh.map((photo) => ({ kind: "photo" as const, photo }))]);
  }, [photos, status]);
  useEffect(() => {
    if (status === "loading") return;
    if (!knownMedia.current) { knownMedia.current = new Set(media.map((m) => m.id)); return; }
    const fresh = media.filter((m) => !knownMedia.current!.has(m.id));
    fresh.forEach((m) => knownMedia.current!.add(m.id));
    if (fresh.length) setQueue((q) => [...q, ...fresh.map((m) => ({ kind: "media" as const, media: m }))]);
  }, [media, status]);
  // A new "🤝" agent note animates the two members' avatars connecting for 3 seconds.
  const knownNotes = useRef<Set<string> | null>(null);
  const [handshake, setHandshake] = useState<AgentMessage | null>(null);
  useEffect(() => {
    if (status === "loading") return;
    if (!knownNotes.current) { knownNotes.current = new Set(agentMessages.map((m) => m.id)); return; }
    const fresh = agentMessages.filter((m) => !knownNotes.current!.has(m.id));
    fresh.forEach((m) => knownNotes.current!.add(m.id));
    const shake = fresh.find((m) => m.content.startsWith("🤝"));
    if (!shake) return;
    setHandshake(shake);
    const t = setTimeout(() => setHandshake(null), 3000);
    return () => clearTimeout(t);
  }, [agentMessages, status]);
  const openPoll = polls.filter((p) => p.status === "open").slice(-1)[0];
  // The presenter settles polls too (same rule as the phones), so a presenter-only replay never leaves a poll
  // stuck on "closing…" over the agents. settlePoll is idempotent on the server.
  const settling = useRef<Set<string>>(new Set());
  useEffect(() => {
    const check = () => {
      const approved = members.filter((m) => m.approved);
      for (const p of polls) {
        if (p.status !== "open" || settling.current.has(p.id)) continue;
        const voted = new Set(pollVotes.filter((v) => v.poll_id === p.id).map((v) => v.member_id));
        const allVoted = approved.length > 0 && approved.every((m) => voted.has(m.id));
        if (allVoted || new Date(p.closes_at).getTime() <= Date.now()) {
          settling.current.add(p.id);
          void settlePoll(p.id).catch(() => settling.current.delete(p.id));
        }
      }
    };
    check();
    const t = setInterval(check, 2000); // the countdown can run out with no new data arriving
    return () => clearInterval(t);
  }, [polls, pollVotes, members]);
  const showing = queue[0];
  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), showing.kind === "media" ? 6000 : 8000);
    return () => clearTimeout(t);
  }, [showing?.kind === "photo" ? showing.photo.id : showing?.media.id]);
  const capEnd = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && lines.length) seen.current = new Set(lines.map((l) => l.id));

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect must return nothing or a cleanup.
  useEffect(() => { capEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [lines.length, translations.length]);
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
    <main className="flex h-dvh flex-col gap-4 overflow-hidden bg-background p-4 text-foreground lg:p-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex items-center gap-3 text-2xl font-semibold">
          <span className="size-4 animate-pulse rounded-full bg-primary" aria-hidden />
          Live
        </span>
        <span className="font-display text-5xl font-semibold tracking-[0.2em]">{room.code}</span>
        <div className="flex gap-2">
          {visible.map((m) => (
            <span key={m.id} title={m.name}><TableAvatar member={m} size={48} level={life.levels.get(m.id)} /></span>
          ))}
        </div>
        {handshake && <HandshakeOverlay msg={handshake} members={visible} />}
        <span className="text-xl text-muted-foreground">{visible.map((m) => m.name).join(" · ")}</span>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {replay ? (
            <div className="flex items-center rounded-md bg-secondary text-muted-foreground" role="group" aria-label="Demo replay">
              <span className="px-3 tabular-nums" aria-live="polite">{paused ? "Paused" : "Replaying"} {replay}</span>
              <button onClick={togglePause} aria-label={paused ? "Resume replay" : "Pause replay"} className="flex size-11 items-center justify-center rounded-md hover:text-foreground">
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              </button>
              <button onClick={cycleSpeed} aria-label={`Replay speed ${speed}x, change`} className="flex min-h-11 items-center gap-1 rounded-md px-2 tabular-nums hover:text-foreground">
                <Gauge className="size-4" /> {speed}×
              </button>
              <button onClick={stopReplay} aria-label="Stop replay" className="flex size-11 items-center justify-center rounded-md hover:text-foreground"><Square className="size-4" /></button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={runReplay} aria-label="Replay demo" className="text-muted-foreground hover:text-foreground">
              <Play /> Replay demo
            </Button>
          )}
          <Button variant="secondary" size="icon" aria-label={full ? "Exit fullscreen" : "Fullscreen"} className="text-muted-foreground hover:text-foreground"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
            {full ? <Minimize /> : <Maximize />}
          </Button>
        </div>
      </header>

      {life.confetti && <Confetti colors={visible.map((m) => m.color)} />}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-3 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1fr)] lg:grid-rows-1 lg:gap-6">
        <section className="flex min-h-0 flex-col rounded-lg border bg-card p-4 lg:p-6">
          <h2 className="mb-4 text-xl font-semibold">Captions</h2>
          <div className="min-h-0 flex-1 overflow-y-auto pr-2">
            {!lines.length && <p className="text-2xl text-muted-foreground">Waiting for someone to speak…</p>}
            <ul className="flex flex-col gap-6">
              {lines.slice(-40).map((l) => {
                const sp = byId.get(l.speaker_id ?? "");
                const trs = translations.filter((t) => t.line_id === l.id && t.language !== l.language);
                return (
                  <li key={l.id} className={`speaker-rule ${seen.current && !seen.current.has(l.id) ? "animate-msg-in" : ""}`} style={{ "--speaker": sp?.color } as React.CSSProperties}>
                    <p className="text-[clamp(1.125rem,1.5vw,1.5rem)] font-semibold speaker-ink" style={{ "--speaker": sp?.color } as React.CSSProperties}>{sp?.name ?? "Unknown speaker"}</p>
                    <p lang={l.language} className="font-text text-[clamp(1.75rem,2.6vw,3rem)]">{l.text}</p>
                    {trs.map((t) => <p key={t.id} lang={t.language} className="mt-1 font-text text-[clamp(1.5rem,2.1vw,2.25rem)] text-muted-foreground">{t.text}</p>)}
                  </li>
                );
              })}
            </ul>
            <div ref={capEnd} />
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-lg border bg-card p-4 lg:p-6" aria-label="The table: who's connected and how balanced the conversation is">
          <h2 className="mb-2 text-xl font-semibold">The table</h2>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 lg:p-6">
            <ConnectionWeb members={visible} life={life} />
          </div>
        </section>

        {openPoll ? (
          <PollTakeover key={openPoll.id} poll={openPoll} votes={pollVotes} members={members} />
        ) : showing ? (
          showing.kind === "media" ? (
            <MediaTakeover key={showing.media.id} media={showing.media} by={byId.get(showing.media.created_by_member_id ?? "")?.name} />
          ) : (
            <PhotoTakeover key={showing.photo.id} photo={showing.photo} captions={captions} by={byId.get(showing.photo.uploader_id ?? "")?.name} group={isGroupPhoto(showing.photo.storage_path)} />
          )
        ) : (
          <section className="flex min-h-0 flex-col rounded-lg border bg-card p-4 lg:p-6">
            <h2 className="mb-4 text-xl font-semibold">The agents</h2>
            <div className="min-h-0 flex-1">
              <AgentFeed msgs={agentMessages} byId={byId} large status={status} retryIn={retryIn} onRetry={retry} levels={life.levels} />
            </div>
          </section>
        )}
      </div>

      <section className="shrink-0">
        <h2 className="mb-2 text-xl font-semibold">Notebook</h2>
        <NotebookStrip entries={notebook} byId={byId} />
      </section>
    </main>
  );
}

function PhotoTakeover({ photo, captions, by, group }: { photo: Photo; captions: { photo_id: string; language: string; caption: string; description: string }[]; by?: string | undefined; group: boolean }) {
  const urls = useSignedUrls([photo.storage_path]);
  const caps = captions.filter((c) => c.photo_id === photo.id);
  const main = caps.find((c) => c.language === "en") ?? caps[0];
  return (
    <section className="animate-takeover flex min-h-0 flex-col gap-4 rounded-lg border bg-card p-4 lg:p-6" aria-live="polite">
      <h2 className="text-xl font-semibold">{group ? "Group photo" : `${by ?? "Someone"} shared a photo`}</h2>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-secondary">
        {urls[photo.storage_path] ? <img src={urls[photo.storage_path]} alt={main?.caption ?? "Shared photo"} className="max-h-full max-w-full object-contain" /> : <Shimmer className="h-full w-full" />}
      </div>
      {main ? (
        <div>
          <p lang={main.language} className="font-text text-[clamp(1.75rem,2.6vw,3rem)] font-semibold">{main.caption}</p>
          {caps.filter((c) => c !== main).map((c) => <p key={c.language} lang={c.language} className="font-text text-[clamp(1.25rem,1.8vw,1.75rem)] text-muted-foreground">{c.caption}</p>)}
        </div>
      ) : <div><Shimmer className="h-8 w-2/3" /><Shimmer className="mt-2 h-6 w-1/2" /></div>}
    </section>
  );
}

/** "🤝" note: the two members' avatars connect with a glowing line for 3 seconds. */
function HandshakeOverlay({ msg, members }: { msg: AgentMessage; members: Member[] }) {
  const byId = new Map(members.map((m) => [m.id, m]));
  let a = msg.from_member_id ? byId.get(msg.from_member_id) : undefined;
  let b = msg.to_member_id ? byId.get(msg.to_member_id) : undefined;
  if (!a || !b) {
    const hay = msg.content.toLowerCase();
    const named = members.filter((m) => hay.includes(m.name.toLowerCase()));
    a ??= named[0];
    b ??= named.find((m) => m.id !== a?.id);
  }
  if (!a || !b) return null;
  return (
    <div className="animate-msg-in flex items-center gap-0 rounded-full border-2 border-input bg-card px-4 py-2" role="status" aria-label={msg.content}>
      <Avatar member={a} size={44} />
      <span className="relative mx-1 h-1 w-16 overflow-visible rounded-full bg-apricot">
        <span className="absolute inset-0 animate-ping rounded-full bg-apricot" />
      </span>
      <Avatar member={b} size={44} />
      <span className="ml-3 max-w-md truncate text-lg text-muted-foreground">{msg.content.replace(/^🤝\s*/, "")}</span>
    </div>
  );
}

function MediaTakeover({ media, by }: { media: Media; by?: string | undefined }) {
  return (
    <section className="animate-takeover flex min-h-0 flex-col gap-4 rounded-lg border bg-card p-4 lg:p-6" aria-live="polite">
      <h2 className="text-xl font-semibold">
        {media.kind === "meme" ? "A meme from the agents" : `${by ? `${by}'s agent` : "An agent"} found a picture`}
      </h2>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-secondary">
        <MediaCard media={media} lang="en" large />
      </div>
    </section>
  );
}
