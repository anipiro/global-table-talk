import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { getMemberId } from "@/lib/room";
import { fmtTime, useRoom } from "@/lib/useRoom";
import { Input } from "@/components/ui/input";

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
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col sm:border-x">
      <header className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/room/$code" params={{ code }} className="-ml-2 flex min-h-11 items-center gap-1 px-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden /> Back to live
          </Link>
          <span className="text-sm text-muted-foreground">{rows.length} lines</span>
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search what was said…"
          aria-label="Search captions"
          className="min-h-12 text-lg"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ id: "all", name: "Everyone", color: "" }, ...members].map((m) => (
            <button key={m.id} onClick={() => setSpeaker(m.id)} aria-pressed={speaker === m.id}
              className={`min-h-11 shrink-0 rounded-md border px-4 text-base font-semibold ${speaker === m.id ? "border-primary bg-primary text-primary-foreground" : "speaker-ink border-input"}`}
              style={speaker !== m.id && m.color ? ({ "--speaker": m.color, background: `color-mix(in oklab, ${m.color} 30%, var(--card))` } as React.CSSProperties) : undefined}>
              {m.name}
            </button>
          ))}
        </div>
      </header>
      <ul className="flex flex-col gap-6 px-4 py-5 text-[20px]">
        {rows.map(({ l, sp, tr }) => (
          <li key={l.id} className="speaker-rule" style={{ "--speaker": sp?.color } as React.CSSProperties}>
            <p className="text-sm text-muted-foreground">
              <span className="speaker-ink font-semibold" style={{ "--speaker": sp?.color } as React.CSSProperties}>{sp?.name ?? "Unknown speaker"}{l.ambiguous ? "?" : ""}</span> · {fmtTime(l.created_at)}
              {l.ambiguous && <span className="text-primary"> · unsure speaker</span>}
            </p>
            <p lang={tr ? me?.language : l.language} className="mt-1 font-text">{tr ?? l.text}</p>
            {tr && <p lang={l.language} className="mt-1 font-text text-base text-muted-foreground">{l.text}</p>}
          </li>
        ))}
        {rows.length === 0 && <p className="py-10 text-center text-muted-foreground">Nothing matches.</p>}
      </ul>
    </main>
  );
}
