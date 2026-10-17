import { useRef } from "react";
import { BookOpen } from "lucide-react";
import type { Media, Member, NotebookEntry } from "@/lib/room";
import { agentName } from "./AgentFeed";
import { MediaCard } from "./Media";
import { EmptyState } from "./EmptyState";

export const NOTEBOOK_SECTIONS: { kind: string; label: string }[] = [
  { kind: "person", label: "People" },
  { kind: "glossary", label: "Glossary" },
  { kind: "decision", label: "Decisions" },
  { kind: "moment", label: "Moments" },
];
const LABEL = Object.fromEntries(NOTEBOOK_SECTIONS.map((s) => [s.kind, s.label]));

/** Entries present on first render don't animate; everything added later slides in and fades from a highlight. */
function useIsNew(entries: { id: string }[]) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(entries.map((e) => e.id));
  return (id: string) => !initial.current!.has(id);
}

function AddedBy({ owner }: { owner: Member | undefined }) {
  return <p className="mt-1 text-sm text-muted-foreground">added by <span className="speaker-ink font-semibold" style={{ "--speaker": owner?.color } as React.CSSProperties}>{owner ? agentName(owner) : "an agent"}</span></p>;
}

/** Notebook grouped into People, Glossary, Decisions, Moments, with counts. Media shows inside its entry, plus a Media section. */
export function NotebookSections({ entries, byId, media = [], lang = "en" }: { entries: NotebookEntry[]; byId: Map<string, Member>; media?: Media[]; lang?: string }) {
  const isNew = useIsNew(entries);
  const isNewMedia = useIsNew(media);
  const linked = new Set(media.filter((m) => m.notebook_id).map((m) => m.id));
  const loose = media.filter((m) => !linked.has(m.id));
  if (!entries.length && !media.length)
    return (
      <EmptyState icon={BookOpen} title="Nothing saved yet.">
        Names, words, decisions and moments the agents pick up are listed here.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-5 pt-2">
      {NOTEBOOK_SECTIONS.map(({ kind, label }) => {
        const list = entries.filter((e) => e.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind}>
            <h3 className="mb-2 flex items-baseline gap-2 text-[1.9rem] leading-none">
              {label} <span className="text-base font-normal tabular-nums text-muted-foreground">{list.length}</span>
            </h3>
            <div className="flex flex-col gap-2">
              {list.map((e) => {
                const attached = media.filter((m) => m.notebook_id === e.id);
                return (
                  <div key={e.id} className={`rounded-2xl bg-card p-3 ${isNew(e.id) ? "animate-fresh" : ""}`}>
                    <p className="font-semibold">{e.title}</p>
                    {e.body && <p className="text-muted-foreground">{e.body}</p>}
                    {attached.map((m) => (
                      <div key={m.id} className={`mt-2 ${isNewMedia(m.id) ? "animate-fresh rounded-md" : ""}`}>
                        <MediaCard media={m} lang={lang} />
                      </div>
                    ))}
                    <AddedBy owner={byId.get(e.owner_member_id ?? "")} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {loose.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-baseline gap-2 text-[1.9rem] leading-none">
            References & memes <span className="text-base font-normal tabular-nums text-muted-foreground">{loose.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {loose.map((m) => (
              <div key={m.id} className={isNewMedia(m.id) ? "animate-fresh rounded-md" : ""}>
                <MediaCard media={m} lang={lang} />
                <AddedBy owner={byId.get(m.created_by_member_id ?? "")} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Presenter strip: horizontal cards, newest first. */
export function NotebookStrip({ entries, byId }: { entries: NotebookEntry[]; byId: Map<string, Member> }) {
  const isNew = useIsNew(entries);
  const sorted = [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (!sorted.length) return <p className="px-2 text-xl text-muted-foreground">Nothing in the notebook yet.</p>;
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {sorted.map((e) => {
        const owner = byId.get(e.owner_member_id ?? "");
        return (
          <div key={e.id} className={`w-[clamp(16rem,24vw,24rem)] shrink-0 rounded-3xl bg-card p-5 ${isNew(e.id) ? "animate-fresh" : ""}`} style={{ borderTop: `4px solid ${owner?.color ?? "var(--border)"}` }}>
            <p className="text-base text-muted-foreground">{LABEL[e.kind] ?? e.kind}</p>
            <p className="mt-1 text-[clamp(1.25rem,1.8vw,1.75rem)] font-semibold">{e.title}</p>
            {e.body && <p className="mt-1 line-clamp-3 text-[clamp(1rem,1.3vw,1.25rem)] text-muted-foreground">{e.body}</p>}
            <AddedBy owner={owner} />
          </div>
        );
      })}
    </div>
  );
}
