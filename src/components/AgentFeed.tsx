import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Image as ImageIcon, WifiOff } from "lucide-react";
import type { AgentMessage, Media, Member } from "@/lib/room";

/** Banter lines from the agents always start with this (see src/server/banter.ts). */
export const BANTER_PREFIX = "😄";

/** Notes like "added a photo of X" / "turned Nika's joke into a meme" point at a media row — find it. */
export function mediaForNote(m: AgentMessage, media: Media[]): Media | undefined {
  if (m.type !== "note") return undefined;
  const photo = /added a photo of (.+?)\.?\s*$/i.exec(m.content)?.[1]?.toLowerCase();
  if (photo)
    return media.find((x) => x.kind === "reference_image" && x.query.toLowerCase() === photo)
      ?? media.find((x) => x.kind === "reference_image" && (x.query.toLowerCase().includes(photo) || photo.includes(x.query.toLowerCase())));
  if (/turned .+ joke into a meme/i.test(m.content))
    return [...media].reverse().find((x) => x.kind === "meme" && x.created_by_member_id === m.from_member_id);
  return undefined;
}

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

/** New messages are revealed one at a time after a short "typing…" moment. A burst (catching up after a
 *  connection drop) is revealed at once instead of making you wait through every typing indicator. */
function useTypingReveal(msgs: AgentMessage[], ready: boolean, delay = 900) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null && ready) initial.current = new Set(msgs.map((m) => m.id));
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const known = initial.current;
  const pendingList = known ? msgs.filter((m) => !known.has(m.id) && !revealed.has(m.id)) : [];
  const burst = pendingList.length > 2;
  const pending = burst ? undefined : pendingList[0];
  useEffect(() => {
    if (burst) { setRevealed((r) => new Set([...r, ...pendingList.map((m) => m.id)])); return; }
    if (!pending) return;
    const t = setTimeout(() => setRevealed((r) => new Set(r).add(pending.id)), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id, burst, pendingList.length, delay]);
  const isShown = (id: string) => !!known && (known.has(id) || revealed.has(id));
  return { isShown, typing: pending, isNew: (id: string) => !!known && !known.has(id) };
}

const describe = (m: AgentMessage, byId: Map<string, Member>, meId?: string | null) =>
  `${agentName(byId.get(m.from_member_id ?? ""), meId)} to ${m.to_member_id ? agentName(byId.get(m.to_member_id), meId) : "the table"}, ${m.type}: ${m.content}`;

/** Chat between the agents at the table: newest at the bottom; follows new messages while you're at the
 *  bottom, and shows an unread marker + "new messages" pill when you've scrolled up.
 *  Keyboard: focus the feed, ↑/↓ moves between messages, Home/End jump to oldest/newest. */
export function AgentFeed({ msgs, byId, meId, large = false, status = "live", retryIn, onRetry, media, onOpenMedia }: {
  msgs: AgentMessage[]; byId: Map<string, Member>; meId?: string | null; large?: boolean;
  status?: FeedStatus; retryIn?: number | null; onRetry?: () => void;
  /** Lets notes like "added a photo of…" open that picture/meme on tap. */
  media?: Media[]; onOpenMedia?: (id: string) => void;
}) {
  const ready = status !== "loading" && status !== "error";
  const { isShown, typing, isNew } = useTypingReveal(msgs, ready);
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unreadFrom, setUnreadFrom] = useState<{ id: string; label: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const [announce, setAnnounce] = useState("");
  const shown = msgs.filter((m) => isShown(m.id));
  const prevCount = useRef<number | null>(null);

  const toBottom = (smooth = true) => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };
  const clearUnread = () => { setUnread(0); setTimeout(() => setUnreadFrom(null), 2500); };

  // New message(s) revealed: follow when at the bottom, otherwise count them as unread.
  useLayoutEffect(() => {
    if (!ready) return;
    const prev = prevCount.current;
    prevCount.current = shown.length;
    if (prev === null) { toBottom(false); return; }
    const added = shown.length - prev;
    if (added <= 0) return;
    const fresh = shown.slice(-added);
    const missed = added > 2;
    setAnnounce(missed ? `${added} agent messages you missed while offline.` : fresh.map((m) => describe(m, byId, meId)).join(". "));
    if (missed) setUnreadFrom({ id: fresh[0]!.id, label: `${added} while you were away` });
    if (atBottom.current) { toBottom(); return; }
    setUnread((n) => n + added);
    setUnreadFrom((u) => u ?? { id: fresh[0]!.id, label: "New" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length, ready]);
  useEffect(() => { if (unread) setAnnounce(`${unread} unread agent message${unread === 1 ? "" : "s"}.`); }, [unread]);
  useEffect(() => { if (typing && atBottom.current) toBottom(); }, [typing?.id]);

  // Connection status announcements.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === status) return;
    if (status === "offline") setAnnounce("Connection lost. Reconnecting automatically.");
    else if (status === "live" && prevStatus.current === "offline") setAnnounce("Reconnected. Agent messages are live again.");
    prevStatus.current = status;
  }, [status]);

  const onScroll = () => {
    const el = box.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current && unread) clearUnread();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>("[data-msg]") ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === "ArrowDown") next = items[Math.min(items.length - 1, i + 1)];
    else if (e.key === "ArrowUp") next = items[i < 0 ? items.length - 1 : Math.max(0, i - 1)];
    else if (e.key === "Home") next = items[0];
    else if (e.key === "End") { next = items[items.length - 1]; clearUnread(); }
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  };

  const av = large ? 48 : 32;
  const big = large ? "text-2xl" : "";
  const live = <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>;

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
        <p className="text-muted-foreground">{retryIn ? `Trying again in ${Math.round(retryIn / 1000)}s…` : "Check the connection, then try again."}</p>
        {onRetry && <button onClick={onRetry} className="min-h-11 rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground">Try again now</button>}
      </div>
    );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {live}
      {status === "offline" && (
        <div role="status" className={`mb-2 flex items-center gap-2 rounded-2xl bg-destructive/15 px-3 py-2 ${large ? "text-xl" : "text-sm"}`}>
          <WifiOff className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span className="flex-1">
            Connection lost — {retryIn ? `reconnecting in ${Math.round(retryIn / 1000)}s` : "waiting for the network"}. You'll catch up on anything missed.
          </span>
          {onRetry && <button onClick={onRetry} className="min-h-11 rounded-full bg-secondary px-3 py-1 font-semibold">Reconnect</button>}
        </div>
      )}
      <div
        ref={box}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="log"
        aria-label={`Agent conversation, ${shown.length} messages${unread ? `, ${unread} unread` : ""}. Use arrow keys to move between messages.`}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!msgs.length ? (
          <div className={`flex flex-col items-center gap-2 py-10 text-center text-muted-foreground ${big}`}>
            <span className="flex gap-1 text-primary" aria-hidden><span className="typing-dot">•</span><span className="typing-dot">•</span><span className="typing-dot">•</span></span>
            <p className="text-foreground">The agents are listening quietly.</p>
            <p className={large ? "text-xl" : "text-sm"}>When someone's agent checks a name, a word or something missed with another agent, it shows up here.</p>
          </div>
        ) : (
          <ol className={`flex flex-col ${large ? "gap-5" : "gap-3"} pt-2 pb-2`}>
            {shown.map((m) => {
              const from = byId.get(m.from_member_id ?? "");
              const to = m.to_member_id ? byId.get(m.to_member_id) : null;
              const banter = m.content.startsWith(BANTER_PREFIX);
              const linked = media && onOpenMedia ? mediaForNote(m, media) : undefined;
              return (
                <li key={m.id}>
                  {m.id === unreadFrom?.id && (
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary" role="separator" aria-label={unreadFrom.label}>
                      <span className="h-px flex-1 bg-primary/50" /> {unreadFrom.label} <span className="h-px flex-1 bg-primary/50" />
                    </div>
                  )}
                  <div data-msg tabIndex={-1} aria-label={describe(m, byId, meId)}
                    className={`flex items-start gap-3 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring ${isNew(m.id) ? "animate-msg-in" : ""}`}>
                    <Avatar member={from} size={av} />
                    <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-secondary ${large ? "p-5" : "p-3"}`}>
                      <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground ${large ? "text-xl" : "text-[0.8em]"}`}>
                        <span className="font-semibold" style={{ color: from?.color }}>{agentName(from, meId)}</span>
                        <span aria-hidden>→</span>
                        {to ? <span className="font-semibold" style={{ color: to.color }}>{agentName(to, meId)}</span> : <span>table</span>}
                        <span className={`ml-1 rounded-full border px-2 ${large ? "text-base" : "text-[0.85em]"} ${TYPE_CLASS[m.type] ?? "border-border"}`}>{m.type}</span>
                      </p>
                      <p className={`mt-1 leading-snug ${large ? "text-[30px]" : ""}`}>{m.content}</p>
                    </div>
                  </div>
                </li>
              );
            })}
            {typing && (
              <li className="flex items-center gap-3 animate-msg-in" aria-hidden>
                <Avatar member={byId.get(typing.from_member_id ?? "")} size={av} />
                <div className={`flex items-center gap-2 rounded-2xl rounded-tl-sm bg-secondary text-muted-foreground ${large ? "px-5 py-4 text-xl" : "px-3 py-2 text-sm"}`}>
                  <span>{agentName(byId.get(typing.from_member_id ?? ""), meId)} is typing</span>
                  <span className="flex gap-1"><span className="typing-dot">•</span><span className="typing-dot">•</span><span className="typing-dot">•</span></span>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>
      {unread > 0 && (
        <button onClick={() => { toBottom(); clearUnread(); }}
          className={`absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-1 rounded-full bg-primary font-semibold text-primary-foreground shadow-lg ${large ? "px-5 py-2 text-xl" : "px-4 py-1.5 text-sm"}`}>
          {unread} new message{unread === 1 ? "" : "s"} <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
