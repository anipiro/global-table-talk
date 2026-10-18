import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Image as ImageIcon, MessagesSquare, WifiOff } from "lucide-react";
import type { AgentMessage, Media, Member } from "@/lib/room";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { BADGE_ICON, BADGE_LABEL, parseBadge } from "@/lib/tableLife";

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

export type FeedStatus = "loading" | "live" | "reconnecting" | "offline" | "error";

/** Pass `level` to show the agent's level orb (1–3) on the avatar. */
export function Avatar({ member, size = 32, level }: { member: Member | undefined; size?: number; level?: number | undefined }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-foreground"
      style={{ width: size, height: size, fontSize: size * 0.45, background: member?.color ? `color-mix(in oklab, ${member.color} 85%, var(--background))` : "var(--muted)" }}
      aria-hidden
    >
      {(member?.name ?? "?").slice(0, 1).toUpperCase()}
      {level && member ? <AgentOrb color={member.color} level={level} avatar={size} /> : null}
    </span>
  );
}

/** The agent's level: a flat disc in the member's colour that grows per level — soft at level 1, full colour at 2,
 *  full colour with an apricot ring at 3. Sits on the avatar's corner, or `inline` next to a name.
 *  Keyed by level so a level-up replays the pop (transform only). */
export function AgentOrb({ color, level, avatar, inline = false }: { color: string; level: number; avatar: number; inline?: boolean }) {
  const d = Math.max(8, Math.round(avatar * [0.3, 0.38, 0.46][level - 1]!));
  const fill = level === 1 ? `color-mix(in oklab, ${color} 70%, var(--background))` : `color-mix(in oklab, ${color} 85%, var(--foreground))`;
  return (
    <span key={level} title={`Level ${level} agent`} role="img" aria-label={`Level ${level} agent`}
      className={`animate-orb-up block rounded-full ${inline ? "" : "absolute -bottom-0.5 -right-0.5 border-2 border-background"}`}
      style={{ width: d, height: d, background: fill, boxShadow: level === 3 ? "0 0 0 2px var(--apricot)" : undefined }} />
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
export function AgentFeed({ msgs, byId, meId, large = false, status = "live", retryIn, onRetry, media, onOpenMedia, levels }: {
  msgs: AgentMessage[]; byId: Map<string, Member>; meId?: string | null; large?: boolean;
  status?: FeedStatus; retryIn?: number | null; onRetry?: () => void;
  /** Lets notes like "added a photo of…" open that picture/meme on tap. */
  media?: Media[]; onOpenMedia?: (id: string) => void; levels?: Map<string, number>;
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

  const big = large ? "text-2xl" : "";
  const live = <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>;

  if (status === "loading")
    return (
      <div className="flex flex-col gap-4 pt-2" aria-busy="true" aria-label="Loading agent messages">
        {[0, 1, 2].map((i) => (
          <div key={i} className="speaker-rule">
            <div className="h-4 w-1/3 animate-pulse rounded-sm bg-secondary" style={{ opacity: 1 - i * 0.25 }} />
            <div className="mt-2 h-10 animate-pulse rounded-sm bg-secondary" style={{ opacity: 1 - i * 0.25 }} />
          </div>
        ))}
      </div>
    );
  if (status === "error")
    return (
      <div className={`flex flex-col items-start gap-3 pt-4 ${big}`} role="alert">
        <p className="flex items-center gap-2 font-semibold"><WifiOff className="h-5 w-5 text-destructive" aria-hidden /> Couldn't load the agents' conversation.</p>
        <p className="text-muted-foreground">{retryIn ? `Trying again in ${Math.round(retryIn / 1000)}s…` : "Check the connection, then try again."}</p>
        {onRetry && <Button onClick={onRetry}>Try again now</Button>}
      </div>
    );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {live}
      {status === "offline" && (
        <div role="status" className={`mb-2 flex items-center gap-2 rounded-xl border-2 border-destructive bg-card px-3 py-2 ${large ? "text-xl" : "text-sm"}`}>
          <WifiOff className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span className="flex-1">
            Connection lost. {retryIn ? `Reconnecting in ${Math.round(retryIn / 1000)}s` : "Waiting for the network"}. You'll catch up on anything missed.
          </span>
          {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Reconnect</Button>}
        </div>
      )}
      <div
        ref={box}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="log"
        aria-label={`Agent conversation, ${shown.length} messages${unread ? `, ${unread} unread` : ""}. Use arrow keys to move between messages.`}
        className="min-h-0 flex-1 overflow-y-auto rounded-md pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!msgs.length ? (
          <EmptyState icon={MessagesSquare} title="No agent messages yet." large={large}>
            They appear when an agent asks another agent about a name, a word or a reference.
          </EmptyState>
        ) : (
          <ol className={`flex flex-col ${large ? "gap-6" : "gap-5"} pt-2 pb-2`}>
            {shown.map((m) => {
              const from = byId.get(m.from_member_id ?? "");
              const to = m.to_member_id ? byId.get(m.to_member_id) : null;
              const banter = m.content.startsWith(BANTER_PREFIX);
              const badge = parseBadge(m);
              const BadgeIcon = badge ? BADGE_ICON[badge.kind] : null;
              const linked = media && onOpenMedia ? mediaForNote(m, media) : undefined;
              return (
                <li key={m.id}>
                  {m.id === unreadFrom?.id && (
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-redbrown" role="separator" aria-label={unreadFrom.label}>
                      <span className="h-px flex-1 bg-redbrown" /> {unreadFrom.label} <span className="h-px flex-1 bg-redbrown" />
                    </div>
                  )}
                  <div data-msg tabIndex={-1} aria-label={describe(m, byId, meId)}
                    className={`speaker-rule rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${isNew(m.id) ? "animate-msg-in" : ""}`}
                    style={{ "--speaker": from?.color } as React.CSSProperties}>
                    <p className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-muted-foreground ${large ? "text-xl" : "text-sm"}`}>
                      <span className="speaker-ink font-semibold" style={{ "--speaker": from?.color } as React.CSSProperties}>{agentName(from, meId)}</span>
                      {from && levels?.get(from.id) ? <span className="self-center"><AgentOrb color={from.color} level={levels.get(from.id)!} avatar={large ? 40 : 28} inline /></span> : null}
                      <span aria-hidden>→</span>
                      {to ? <span className="speaker-ink font-semibold" style={{ "--speaker": to.color } as React.CSSProperties}>{agentName(to, meId)}</span> : <span>table</span>}
                      <span className={m.type === "missed" ? "text-destructive" : ""}>· {banter ? "banter" : badge ? "badge" : m.type}</span>
                    </p>
                    {badge && BadgeIcon ? (
                      <p className={`mt-1 flex items-start gap-2 font-text ${large ? "text-[clamp(1.5rem,2.2vw,2.25rem)]" : ""}`}>
                        <span className="mt-0.5 grid shrink-0 place-items-center rounded-full bg-apricot p-1 text-foreground" title={BADGE_LABEL[badge.kind]}>
                          <BadgeIcon className={large ? "size-7" : "size-4"} aria-label={BADGE_LABEL[badge.kind]} />
                        </span>
                        <span>{badge.text}</span>
                      </p>
                    ) : linked ? (
                      <button onClick={() => onOpenMedia!(linked.id)}
                        className={`mt-1 flex items-center gap-2 rounded-md text-left font-text underline decoration-brown/40 decoration-2 underline-offset-4 hover:decoration-brown ${large ? "text-[clamp(1.5rem,2.2vw,2.25rem)]" : ""}`}
                        aria-label={`${m.content} — open the ${linked.kind === "meme" ? "meme" : "picture"}`}>
                        <ImageIcon className={`shrink-0 ${large ? "size-7" : "size-4"}`} aria-hidden />
                        <span>{m.content}</span>
                      </button>
                    ) : (
                      <p className={`mt-1 font-text ${large ? "text-[clamp(1.5rem,2.2vw,2.25rem)]" : ""}`}>{m.content}</p>
                    )}
                  </div>
                </li>
              );
            })}
            {typing && (
              <li className="speaker-rule animate-msg-in" aria-hidden style={{ "--speaker": byId.get(typing.from_member_id ?? "")?.color } as React.CSSProperties}>
                <div className={`flex items-center gap-2 text-muted-foreground ${large ? "text-xl" : "text-sm"}`}>
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
          className={`absolute inset-x-0 bottom-0 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brown font-bold text-cream ${large ? "text-xl" : "text-base"}`}>
          {unread} new message{unread === 1 ? "" : "s"} <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
