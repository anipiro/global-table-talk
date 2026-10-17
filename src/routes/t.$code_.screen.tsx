import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minimize, Play } from "lucide-react";
import { useRoom } from "@/lib/useRoom";
import { AgentFeed, Avatar } from "@/components/AgentFeed";
import { NotebookStrip } from "@/components/Notebook";
import { replayDemo } from "@/lib/demoScript";

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
  const { room, members, lines, translations, agentMessages, notebook, status, retry } = useRoom(code);
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const [full, setFull] = useState(false);
  const [replay, setReplay] = useState<string | null>(null);
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
    setReplay("Starting…");
    try {
      await replayDemo(room!.id, members, (i, n) => setReplay(`${i}/${n}`));
    } finally {
      setTimeout(() => setReplay(null), 1500);
    }
  }

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
          <button onClick={runReplay} disabled={!!replay} aria-label="Replay demo"
            className="flex items-center gap-1 rounded-full bg-secondary/60 px-3 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-70">
            <Play className="h-3.5 w-3.5" /> {replay ? `Replaying ${replay}` : "Replay demo"}
          </button>
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

        <section className="flex min-h-0 flex-col rounded-3xl bg-card/60 p-6">
          <h2 className="mb-4 text-lg uppercase tracking-widest text-muted-foreground">The agents</h2>
          <div className="min-h-0 flex-1">
            <AgentFeed msgs={agentMessages} byId={byId} large status={status} onRetry={retry} />
          </div>
        </section>
      </div>

      <section className="shrink-0">
        <h2 className="mb-2 text-lg uppercase tracking-widest text-muted-foreground">Notebook</h2>
        <NotebookStrip entries={notebook} byId={byId} />
      </section>
    </main>
  );
}
