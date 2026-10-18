import { useRef } from "react";
import { BarChart3, BookOpen, Users } from "lucide-react";
import type { AgentMessage, Card, Media, Member, NotebookEntry } from "@/lib/room";
import { renderBold } from "@/lib/richText";
import { agentName } from "./AgentFeed";
import { isTonightMedia, MediaCard } from "./Media";
import { EmptyState } from "./EmptyState";
import { pollOptions, pollText, VoteDots, type Poll, type PollVote } from "./Polls";

export const NOTEBOOK_SECTIONS: { kind: string; label: string }[] = [
  { kind: "person", label: "People" },
  { kind: "glossary", label: "Glossary" },
  { kind: "decision", label: "Decisions" },
  { kind: "moment", label: "Moments" },
];
const LABEL = Object.fromEntries(NOTEBOOK_SECTIONS.map((s) => [s.kind, s.label]));

/** Entries present on first render don't animate; everything added later slides in and fades from a highlight. */
export function useIsNew(entries: { id: string }[]) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(entries.map((e) => e.id));
  return (id: string) => !initial.current!.has(id);
}

function AddedBy({ owner }: { owner: Member | undefined }) {
  return <p className="mt-1 text-sm text-muted-foreground">added by <span className="speaker-ink font-semibold" style={{ "--speaker": owner?.color } as React.CSSProperties}>{owner ? agentName(owner) : "an agent"}</span></p>;
}

function SectionTitle({ label, n }: { label: string; n: number }) {
  return (
    <h3 className="mb-2 flex items-baseline gap-2 text-[1.9rem] leading-none">
      {label} <span className="text-base font-normal tabular-nums text-muted-foreground">{n}</span>
    </h3>
  );
}

/** Every poll of the night, open or closed, with vote counts and the result. */
function PollHistory({ polls, votes, byId, lang }: { polls: Poll[]; votes: PollVote[]; byId: Map<string, Member>; lang: string }) {
  const sorted = [...polls].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return (
    <section>
      <SectionTitle label="Polls" n={sorted.length} />
      <div className="flex flex-col gap-2">
        {sorted.map((p) => {
          const pv = votes.filter((v) => v.poll_id === p.id);
          const open = p.status === "open";
          return (
            <div key={p.id} className="rounded-2xl bg-card p-3">
              <p className="flex items-center justify-between gap-2 font-semibold">
                <span className="flex items-center gap-2"><BarChart3 className="size-4 shrink-0" aria-hidden /> {pollText(p.question_by_language, lang)}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide ${open ? "bg-primary text-primary-foreground" : "bg-apricot text-foreground"}`}>{open ? "Voting" : "Closed"}</span>
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {pollOptions(p).map((o) => (
                  <li key={o.id} className={`flex items-center justify-between gap-2 ${!open && p.result_option_id === o.id ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                    <span>{pollText(o.label_by_language, lang)}</span>
                    <VoteDots votes={pv} optionId={o.id} byId={byId} />
                  </li>
                ))}
              </ul>
              {!open && <p className="mt-2 text-sm">{p.result_text_by_language ? pollText(p.result_text_by_language, lang) : "No decision yet"}</p>}
              <AddedBy owner={byId.get(p.created_by_member_id ?? "")} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Common ground the agents found: public 🤝 notes for the table, plus my own private "shared" cards. */
function CommonGround({ notes, cards, byId }: { notes: AgentMessage[]; cards: Card[]; byId: Map<string, Member> }) {
  return (
    <section>
      <SectionTitle label="Common ground" n={notes.length} />
      <div className="flex flex-col gap-2">
        {cards.map((c) => (
          <div key={c.id} className="rounded-2xl bg-aubergine p-3 text-cream">
            <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-apricot"><Users className="size-3.5" aria-hidden /> COMMON GROUND · JUST FOR YOU</p>
            <p className="mt-1 font-display text-[1.5rem] leading-none">{c.title}</p>
            <p className="mt-1 text-cream-2">{renderBold(c.body)}</p>
          </div>
        ))}
        {notes.map((n) => {
          const a = byId.get(n.from_member_id ?? ""), b = byId.get(n.to_member_id ?? "");
          return (
            <div key={n.id} className="flex items-center gap-3 rounded-2xl bg-card p-3">
              <span className="flex shrink-0 items-center" aria-hidden>
                {[a, b].map((m, i) => (
                  <span key={i} className="flex items-center">
                    {i > 0 && <span className="mx-1 h-[3px] w-4 rounded-full bg-apricot" />}
                    <span className="grid size-7 place-items-center rounded-full text-xs font-extrabold leading-none text-foreground"
                      style={{ background: m ? `color-mix(in oklab, ${m.color} 85%, var(--background))` : "var(--muted)" }}>{m?.name.slice(0, 1).toUpperCase() ?? "?"}</span>
                  </span>
                ))}
              </span>
              <p className="text-sm">{n.content.replace(/^🤝\s*/, "")}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Notebook grouped into People, Glossary, Decisions, Moments, with counts. Media shows inside its entry, plus a Media section. Closed polls appear under Decisions; every poll and every common-ground find also has its own section. */
export function NotebookSections({ entries, byId, media = [], lang = "en", polls = [], pollVotes = [], agentMessages = [], myCards = [] }: { entries: NotebookEntry[]; byId: Map<string, Member>; media?: Media[]; lang?: string; polls?: Poll[]; pollVotes?: PollVote[]; agentMessages?: AgentMessage[]; myCards?: Card[] }) {
  const isNew = useIsNew(entries);
  const isNewMedia = useIsNew(media);
  const linked = new Set(media.filter((m) => m.notebook_id).map((m) => m.id));
  const loose = media.filter((m) => !linked.has(m.id) && !isTonightMedia(m));
  const closedPolls = polls.filter((p) => p.status === "closed");
  const groundNotes = agentMessages.filter((m) => m.type === "note" && m.content.startsWith("🤝"));
  if (!entries.length && !media.length && !polls.length && !groundNotes.length && !myCards.length)
    return (
      <EmptyState icon={BookOpen} title="Nothing saved yet.">
        Names, words, decisions and moments the agents pick up are listed here.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-5 pt-2">
      {(groundNotes.length > 0 || myCards.length > 0) && <CommonGround notes={groundNotes} cards={myCards} byId={byId} />}
      {polls.length > 0 && <PollHistory polls={polls} votes={pollVotes} byId={byId} lang={lang} />}
      {NOTEBOOK_SECTIONS.map(({ kind, label }) => {
        const list = entries.filter((e) => e.kind === kind);
        const sectionPolls = kind === "decision" ? closedPolls : [];
        if (!list.length && !sectionPolls.length) return null;
        return (
          <section key={kind}>
            <SectionTitle label={label} n={list.length + sectionPolls.length} />
            {sectionPolls.length > 0 && (
              <div className="mb-2 flex flex-col gap-2">
                {sectionPolls.map((p) => (
                  <div key={p.id} className="rounded-2xl bg-card p-3">
                    <p className="flex items-center gap-2 font-semibold"><BarChart3 className="size-4 shrink-0" aria-hidden /> {pollText(p.question_by_language, lang)}</p>
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
