import { useEffect, useMemo, useState } from "react";
import { BarChart3, PartyPopper, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Member } from "@/lib/room";
import type { Database } from "@/integrations/supabase/types";

export type Poll = Database["public"]["Tables"]["polls"]["Row"];
export type PollVote = Database["public"]["Tables"]["poll_votes"]["Row"];

export type PollOption = { id: string; label_by_language: Record<string, string> };

/** Pick text in the viewer's language, falling back to English then any language. */
export function pollText(map: unknown, lang: string): string {
  const m = (map ?? {}) as Record<string, string>;
  return m[lang] ?? m["en"] ?? Object.values(m)[0] ?? "";
}

export function pollOptions(poll: Poll): PollOption[] {
  return Array.isArray(poll.options) ? (poll.options as unknown as PollOption[]) : [];
}

/** Insert or change my vote (one row per poll+member). */
export async function votePoll(pollId: string, memberId: string, optionId: string) {
  const { error } = await supabase
    .from("poll_votes")
    .upsert({ poll_id: pollId, member_id: memberId, option_id: optionId }, { onConflict: "poll_id,member_id" });
  if (error) throw error;
}

export { settlePoll } from "@/lib/agent";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Countdown({ closesAt }: { closesAt: string }) {
  const now = useNow();
  const left = Math.max(0, Math.ceil((new Date(closesAt).getTime() - now) / 1000));
  return <span className="tabular-nums text-muted-foreground">{left > 0 ? `${left}s left` : "closing…"}</span>;
}

/** Colored dots: one per vote, in the voter's member color. */
export function VoteDots({ votes, optionId, byId }: { votes: PollVote[]; optionId: string; byId: Map<string, Member> }) {
  const mine = votes.filter((v) => v.option_id === optionId);
  return (
    <span className="flex items-center gap-1">
      {mine.map((v) => (
        <span key={v.id} className="h-2.5 w-2.5 rounded-full" style={{ background: byId.get(v.member_id) ? `color-mix(in oklab, ${byId.get(v.member_id)!.color} 70%, var(--foreground))` : "var(--muted-foreground)" }} title={byId.get(v.member_id)?.name} />
      ))}
    </span>
  );
}

/** Phone: the open poll slides up above the controls; closed polls show the result with a celebration. */
export function PollCard({
  poll,
  votes,
  members,
  meId,
  lang,
  big,
  onDismiss,
}: {
  poll: Poll;
  votes: PollVote[];
  members: Member[];
  meId: string;
  lang: string;
  big?: boolean;
  onDismiss?: (pollId: string) => void;
}) {
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const options = pollOptions(poll);
  const myVote = votes.find((v) => v.poll_id === poll.id && v.member_id === meId);
  const pollVotes = votes.filter((v) => v.poll_id === poll.id);
  const open = poll.status === "open";
  const resultText = poll.result_text_by_language ? pollText(poll.result_text_by_language, lang) : "";

  return (
    <div
      role="status"
      className={`animate-sheet-up pointer-events-auto rounded-3xl border-2 border-input bg-card p-4 ${big ? "text-[20px]" : "text-[17px]"}`}
    >
      <p className="mb-1 flex items-center justify-between gap-2 text-xs font-bold tracking-wide text-muted-foreground">
        <span className="flex items-center gap-1.5"><BarChart3 className="size-3.5" aria-hidden /> THE AGENTS ARE ASKING</span>
        <span className="flex items-center gap-2">
          {open && <Countdown closesAt={poll.closes_at} />}
          {onDismiss && (
            <button
              aria-label="Dismiss poll"
              onClick={() => onDismiss(poll.id)}
              className="-m-3 flex size-11 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground motion-safe:active:scale-90"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </span>
      </p>
      <p className="mb-3 font-display text-[1.9em] leading-none">{pollText(poll.question_by_language, lang)}</p>
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const chosen = myVote?.option_id === o.id;
          const isResult = !open && poll.result_option_id === o.id;
          return (
            <button
              key={o.id}
              disabled={!open}
              onClick={() => void votePoll(poll.id, meId, o.id).catch(() => {})}
              className={`flex min-h-12 items-center justify-between gap-2 rounded-md border-2 px-4 py-2.5 text-left font-semibold transition-[background-color,border-color] duration-150 motion-reduce:transition-none ${
                chosen ? "border-primary bg-primary text-primary-foreground" : isResult ? "border-apricot bg-apricot text-foreground" : "border-input bg-card text-foreground hover:border-primary hover:bg-pick-hover"
              } ${open ? "cursor-pointer motion-safe:active:scale-[0.98]" : "cursor-default"}`}
            >
              <span>{pollText(o.label_by_language, lang)}</span>
              <VoteDots votes={pollVotes} optionId={o.id} byId={byId} />
            </button>
          );
        })}
      </div>
      {!open && (
        <p className="animate-msg-in mt-3 flex items-center gap-2 rounded-2xl bg-apricot px-3 py-2 text-foreground">
          <PartyPopper className="size-5 shrink-0" aria-hidden />
          <span className="font-semibold">{resultText || "Decided!"}</span>
        </p>
      )}
      {open && (
        <p className="mt-2 text-sm text-muted-foreground">
          {pollVotes.length} of {members.filter((m) => m.approved).length} voted{myVote ? " · tap again to change" : ""}
        </p>
      )}
    </div>
  );
}

/** Presenter: an open poll takes over the right half with live vote bars. */
export function PollTakeover({ poll, votes, members }: { poll: Poll; votes: PollVote[]; members: Member[] }) {
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const options = pollOptions(poll);
  const pollVotes = votes.filter((v) => v.poll_id === poll.id);
  const max = Math.max(1, ...options.map((o) => pollVotes.filter((v) => v.option_id === o.id).length));
  return (
    <section className="animate-takeover flex min-h-0 flex-col gap-6 rounded-lg border bg-card p-4 lg:p-6" aria-live="polite">
      <h2 className="flex items-center justify-between text-xl font-semibold">
        <span className="flex items-center gap-2"><BarChart3 className="size-5" aria-hidden /> Live poll</span>
        <span className="font-sans text-lg"><Countdown closesAt={poll.closes_at} /></span>
      </h2>
      <p className="font-display text-[clamp(2.25rem,3.2vw,3.5rem)] leading-none">{pollText(poll.question_by_language, "en")}</p>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-5">
        {options.map((o) => {
          const n = pollVotes.filter((v) => v.option_id === o.id).length;
          return (
            <div key={o.id}>
              <div className="mb-2 flex items-center justify-between font-text text-[clamp(1.25rem,1.8vw,1.75rem)] font-semibold">
                <span>{pollText(o.label_by_language, "en")}</span>
                <VoteDots votes={pollVotes} optionId={o.id} byId={byId} />
              </div>
              <div className="h-6 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-brown transition-[width] duration-500" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="font-text text-xl text-muted-foreground">{pollVotes.length} of {members.filter((m) => m.approved).length} voted</p>
    </section>
  );
}
