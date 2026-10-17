import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, WifiOff } from "lucide-react";
import type { AgentMessage, Member } from "@/lib/room";

const TYPE_CLASS: Record<string, string> = {
  ask: "text-type-ask border-type-ask/40 bg-type-ask/10",
  answer: "text-type-answer border-type-answer/40 bg-type-answer/10",
  note: "text-type-note border-type-note/40 bg-type-note/10",
  missed: "text-type-missed border-type-missed/40 bg-type-missed/10",
  bridge: "text-type-bridge border-type-bridge/40 bg-type-bridge/10",
};

export type FeedStatus = "loading" | "live" | "reconnecting" | "offline" | "error";

export function Avatar({ member, size = 32 }: { member: Member | undefined; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size * 0.45, background: member?.color ?? "var(--muted)" }}
      aria-hidden
    >
      {(member?.name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** "Nika's agent"; the viewer's own agent (or a member literally named "You") reads "Your agent". */
export const agentName = (m: Member | undefined, meId?: string | null) =>
  !m ? "An agent" : m.id === meId || m.name.trim().toLowerCase() === "you" ? "Your agent" : `${m.name}'s agent`;

/** Messages that arrive after mount are revealed one at a time, each after a short "typing…" moment. */
function useTypingReveal(msgs: AgentMessage[], ready: boolean, delay = 900) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null && ready) initial.current = new Set(msgs.map((m) => m.id));
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const known = initial.current;
  const pending = known ? msgs.find((m) => !known.has(m.id) && !revealed.has(m.id)) : undefined;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setRevealed((r) => new Set(r).add(pending.id)), delay);
    return () => clearTimeout(t);
  }, [pending?.id, delay]);
  const isShown = (id: string) => !!known && (known.has(id) || revealed.has(id));
  return { isShown, typing: pending, isNew: (id: string) => !!known && !known.has(id) };
}

/** Chat between the agents at the table: newest at the bottom; follows new messages while you're at the
 *  bottom, and shows an unread marker + "new messages" pill when you've scrolled up. */
export function AgentFeed({ msgs, byId, meId, large = false, status = "live", onRetry }: {
  msgs: AgentMessage[]; byId: Map<string, Member>; meId?: string | null; large?: boolean; status?: FeedStatus; onRetry?: () => void;
}) {
  const ready = status !== "loading" && status !== "error";
  const { isShown, typing, isNew } = useTypingReveal(msgs, ready);
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unreadFrom, setUnreadFrom] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const shown = msgs.filter((m) => isShown(m.id));
  const lastShown = shown[shown.length - 1]?.id;
  const prevLast = useRef<string | undefined>(undefined);

  const toBottom = (smooth = true) => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // New message revealed: follow it when at the bottom, otherwise count it as unread.
  useLayoutEffect(() => {
    if (!lastShown || lastShown === prevLast.current) return;
    const first = prevLast.current === undefined;
    prevLast.current = lastShown;
    if (first || atBottom.current) { toBottom(!first); return; }
    setUnread((n) => n + 1);
    setUnreadFrom((u) => u ?? lastShown);
  }, [lastShown]);
  useEffect(() => { if (typing && atBottom.current) toBottom(); }, [typing?.id]);

  const onScroll = () => {
    const el = box.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current && unread) { setUnread(0); setTimeout(() => setUnreadFrom(null), 2500); }
  };

  const av = large ? 48 : 32;
  const big = large ? "text-2xl" : "";

  if (status === "loading")
    return (
      <div className="flex flex-col gap-3 pt-2" aria-busy="true" aria-label="Loading agent messages">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="animate-pulse rounded-full bg-secondary" style={{ width: av, height: av }} />
            <div className="h-16 flex-1 animate-pulse rounded-2xl bg-secondary" style={{ opacity: 1 - i * 0.25 }} />
          </div>
        ))}
      </div>
    );
  if (status === "error")
    return (
      <div className={`flex flex-col items-start gap-3 pt-4 ${big}`} role="alert">
        <p className="flex items-center gap-2 font-semibold"><WifiOff className="h-5 w-5 text-destructive" /> Couldn't load the agents' conversation.</p>
        <p className="text-muted-foreground">Check the connection, then try again.</p>
        {onRetry && <button onClick={onRetry} className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground">Try again</button>}
      </div>
    );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {status === "offline" && (
        <div role="status" className={`mb-2 flex items-center gap-2 rounded-2xl bg-destructive/15 px-3 py-2 ${large ? "text-xl" : "text-sm"}`}>
          <WifiOff className="h-4 w-4 shrink-0 text-destructive" />
          <span className="flex-1">Connection lost — new agent messages will appear when it's back.</span>
          {onRetry && <button onClick={onRetry} className="rounded-full bg-secondary px-3 py-1 font-semibold">Reconnect</button>}
        </div>
      )}
      <div ref={box} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pr-1">
        {!msgs.length ? (
          <div className={`flex flex-col items-center gap-2 py-10 text-center text-muted-foreground ${big}`}>
            <span className="flex gap-1 text-primary"><span className="typing-dot">•</span><span className="typing-dot">•</span><span className="typing-dot">•</span></span>
            <p>No agent messages yet.</p>
            <p className={large ? "text-xl" : "text-sm"}>When someone's agent checks a name, a word or something missed with another agent, it shows up here.</p>
          </div>
        ) : (
          <div className={`flex flex-col ${large ? "gap-5" : "gap-3"} pt-2 pb-2`}>
            {shown.map((m) => {
              const from = byId.get(m.from_member_id ?? "");
              const to = m.to_member_id ? byId.get(m.to_member_id) : null;
              return (
                <div key={m.id}>
                  {m.id === unreadFrom && (
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary" aria-label="New messages">
                      <span className="h-px flex-1 bg-primary/50" /> New <span className="h-px flex-1 bg-primary/50" />
                    </div>
                  )}
                  <div className={`flex items-start gap-3 ${isNew(m.id) ? "animate-msg-in" : ""}`}>
                    <Avatar member={from} size={av} />
                    <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-secondary ${large ? "p-5" : "p-3"}`}>
                      <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground ${large ? "text-xl" : "text-sm"}`}>
                        <span className="font-semibold" style={{ color: from?.color }}>{agentName(from, meId)}</span>
                        <span aria-hidden>→</span>
                        {to ? <span className="font-semibold" style={{ color: to.color }}>{agentName(to, meId)}</span> : <span>table</span>}
                        <span className={`ml-1 rounded-full border px-2 ${large ? "text-base" : "text-xs"} ${TYPE_CLASS[m.type] ?? "border-border"}`}>{m.type}</span>
                      </p>
                      <p className={`mt-1 leading-snug ${large ? "text-[30px]" : ""}`}>{m.content}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            {typing && (
              <div className="flex items-center gap-3 animate-msg-in" aria-live="polite">
                <Avatar member={byId.get(typing.from_member_id ?? "")} size={av} />
                <div className={`flex items-center gap-2 rounded-2xl rounded-tl-sm bg-secondary text-muted-foreground ${large ? "px-5 py-4 text-xl" : "px-3 py-2 text-sm"}`}>
                  <span>{agentName(byId.get(typing.from_member_id ?? ""), meId)} is typing</span>
                  <span className="flex gap-1"><span className="typing-dot">•</span><span className="typing-dot">•</span><span className="typing-dot">•</span></span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {unread > 0 && (
        <button onClick={() => { toBottom(); setUnread(0); setTimeout(() => setUnreadFrom(null), 2500); }}
          className={`absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary font-semibold text-primary-foreground shadow-lg ${large ? "px-5 py-2 text-xl" : "px-4 py-1.5 text-sm"}`}>
          {unread} new message{unread === 1 ? "" : "s"} <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
