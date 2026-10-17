import { useRef } from "react";
import { BarChart3 } from "lucide-react";
import type { Media, Member, NotebookEntry } from "@/lib/room";
import { agentName } from "./AgentFeed";
import { isTonightMedia, MediaCard } from "./Media";
import { pollText, type Poll } from "./Polls";

export const NOTEBOOK_SECTIONS: { kind: string; label: string }[] = [
  { kind: "person", label: "People" },
  { kind: "glossary", label: "Glossary" },
  { kind: "decision", label: "Decisions" },
  { kind: "moment", label: "Moments" },
];
const LABEL = Object.fromEntries(NOTEBOOK_SECTIONS.map((s) => [s.kind, s.label]));

/** Entries present on first render don't animate; everything added later slides in and glows. */
export function useIsNew(entries: { id: string }[]) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(entries.map((e) => e.id));
  return (id: string) => !initial.current!.has(id);
}

function AddedBy({ owner }: { owner: Member | undefined }) {
  return <p className="mt-1 text-xs text-muted-foreground">added by <span style={{ color: owner?.color }}>{owner ? agentName(owner) : "an agent"}</span></p>;
}

/** Notebook grouped into People, Glossary, Decisions, Moments, with counts. Media shows inside its entry, plus a Media section. Closed polls appear under Decisions. */
export function NotebookSections({ entries, byId, media = [], lang = "en", polls = [] }: { entries: NotebookEntry[]; byId: Map<string, Member>; media?: Media[]; lang?: string; polls?: Poll[] }) {
  const isNew = useIsNew(entries);
  const isNewMedia = useIsNew(media);
  const linked = new Set(media.filter((m) => m.notebook_id).map((m) => m.id));
  const loose = media.filter((m) => !linked.has(m.id) && !isTonightMedia(m));
  const closedPolls = polls.filter((p) => p.status === "closed");
  if (!entries.length && !media.length && !closedPolls.length) return <p className="pt-4 text-muted-foreground">The agents will jot down people, words, decisions and moments here.</p>;
  return (
    <div className="flex flex-col gap-5 pt-2">
      {NOTEBOOK_SECTIONS.map(({ kind, label }) => {
        const list = entries.filter((e) => e.kind === kind);
        const sectionPolls = kind === "decision" ? closedPolls : [];
        return (
          <section key={kind}>
            <h3 className="mb-2 flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
              {label} <span className="rounded-full bg-secondary px-2 text-xs tabular-nums normal-case tracking-normal">{list.length + sectionPolls.length}</span>
            </h3>
            {!list.length && !sectionPolls.length && <p className="text-sm text-muted-foreground/70">Nothing yet.</p>}
            {sectionPolls.length > 0 && (
              <div className="mb-2 flex flex-col gap-2">
                {sectionPolls.map((p) => (
                  <div key={p.id} className="rounded-2xl bg-secondary p-3">
                    <p className="flex items-center gap-2 font-semibold"><BarChart3 className="h-4 w-4 text-primary" aria-hidden /> {pollText(p.question_by_language, lang)}</p>
                    <p className="text-muted-foreground">{p.result_text_by_language ? pollText(p.result_text_by_language, lang) : "Decided by vote"}</p>
                    <AddedBy owner={byId.get(p.created_by_member_id ?? "")} />
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              {list.map((e) => {
                const attached = media.filter((m) => m.notebook_id === e.id);
                return (
                  <div key={e.id} className={`rounded-2xl bg-secondary p-3 ${isNew(e.id) ? "animate-glow" : ""}`}>
                    <p className="font-semibold">{e.title}</p>
                    {e.body && <p className="text-muted-foreground">{e.body}</p>}
                    {attached.map((m) => (
                      <div key={m.id} className={`mt-2 ${isNewMedia(m.id) ? "animate-glow rounded-2xl" : ""}`}>
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
          <h3 className="mb-2 flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
            References & memes <span className="rounded-full bg-secondary px-2 text-xs tabular-nums normal-case tracking-normal">{loose.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {loose.map((m) => (
              <div key={m.id} className={isNewMedia(m.id) ? "animate-glow rounded-2xl" : ""}>
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
  if (!sorted.length) return <p className="px-2 text-xl text-muted-foreground">The notebook fills up as the agents learn things.</p>;
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {sorted.map((e) => {
        const owner = byId.get(e.owner_member_id ?? "");
        return (
          <div key={e.id} className={`w-80 shrink-0 rounded-3xl bg-card p-5 ${isNew(e.id) ? "animate-glow" : ""}`} style={{ borderTop: `4px solid ${owner?.color ?? "var(--border)"}` }}>
            <p className="text-sm uppercase tracking-widest text-muted-foreground">{LABEL[e.kind] ?? e.kind}</p>
            <p className="mt-1 text-2xl font-semibold leading-tight">{e.title}</p>
            {e.body && <p className="mt-1 line-clamp-3 text-lg text-muted-foreground">{e.body}</p>}
            <AddedBy owner={owner} />
          </div>
        );
      })}
    </div>
  );
}
