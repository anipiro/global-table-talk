import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getMemberId } from "@/lib/room";
import { fmtTime, useRoom } from "@/lib/useRoom";

export const Route = createFileRoute("/history/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Caption history — Gamige" },
      { name: "description", content: "Search everything said at the table, with times and speakers." },
      { property: "og:title", content: "Caption history — Gamige" },
      { property: "og:description", content: "Search tonight's conversation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { code } = Route.useParams();
  const { members, lines, translations } = useRoom(code);
  const me = members.find((m) => m.id === getMemberId(code));
  const [q, setQ] = useState("");
  const [speaker, setSpeaker] = useState<string>("all");
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines
      .map((l) => ({
        l,
        sp: byId.get(l.speaker_id ?? ""),
        tr: me && l.language !== me.language ? translations.find((t) => t.line_id === l.id && t.language === me.language)?.text : undefined,
        all: translations.filter((t) => t.line_id === l.id).map((t) => t.text),
      }))
      .filter((r) => speaker === "all" || r.l.speaker_id === speaker)
      .filter((r) => !needle || [r.l.text, r.sp?.name ?? "", ...r.all].some((s) => s.toLowerCase().includes(needle)))
      .reverse();
  }, [lines, translations, byId, me, q, speaker]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <Link to="/room/$code" params={{ code }} className="text-muted-foreground">← Back to live</Link>
          <span className="text-sm text-muted-foreground">{rows.length} lines</span>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search what was said…"
          aria-label="Search captions"
          className="rounded-2xl border bg-card px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
          {[{ id: "all", name: "Everyone", color: "" }, ...members].map((m) => (
            <button key={m.id} onClick={() => setSpeaker(m.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 ${speaker === m.id ? "bg-primary text-primary-foreground" : ""}`}
              style={speaker !== m.id && m.color ? { color: m.color } : undefined}>
              {m.name}
            </button>
          ))}
        </div>
      </header>
      <ul className="flex flex-col gap-4 px-4 py-4 text-[20px]">
        {rows.map(({ l, sp, tr }) => (
          <li key={l.id} className="rounded-2xl bg-card p-4">
            <p className="text-sm"><span className="font-semibold" style={{ color: sp?.color }}>{sp?.name ?? "Someone"}</span> <span className="text-muted-foreground">· {fmtTime(l.created_at)}</span></p>
            <p className="mt-1 leading-snug">{tr ?? l.text}</p>
            {tr && <p className="mt-1 text-base text-muted-foreground">{l.text}</p>}
          </li>
        ))}
        {rows.length === 0 && <p className="py-10 text-center text-muted-foreground">Nothing matches.</p>}
      </ul>
    </main>
  );
}
