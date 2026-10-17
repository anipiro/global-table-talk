import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AgentMessage, Card, Line, Member, NotebookEntry, Photo, PhotoCaption, Room, SpeakerCorrection, Translation } from "./room";

type Row = { id: string; created_at?: string };
function apply<R extends Row>(list: R[], p: { eventType: string; new: unknown; old: unknown }): R[] {
  if (p.eventType === "DELETE") {
    const id = (p.old as Row).id;
    return list.filter((r) => r.id !== id);
  }
  const row = p.new as R;
  const i = list.findIndex((r) => r.id === row.id);
  const next = i >= 0 ? list.map((r) => (r.id === row.id ? row : r)) : [...list, row];
  return row.created_at ? next.sort((a, b) => (a.created_at! < b.created_at! ? -1 : 1)) : next;
}

export function useRoom(code: string) {
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [notebook, setNotebook] = useState<NotebookEntry[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [captions, setCaptions] = useState<PhotoCaption[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [corrections, setCorrections] = useState<SpeakerCorrection[]>([]);
  /** loading → live; "offline" when the realtime connection drops; "error" when the first load failed. */
  const [status, setStatus] = useState<"loading" | "live" | "offline" | "error">("loading");
  const [nonce, setNonce] = useState(0);
  const lineIds = useRef(new Set<string>());
  const photoIds = useRef(new Set<string>());
  useEffect(() => {
    lineIds.current = new Set(lines.map((l) => l.id));
  }, [lines]);
  useEffect(() => {
    photoIds.current = new Set(photos.map((l) => l.id));
  }, [photos]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      // Keep showing what we have while reconnecting; only a first load shows the loading state.
      setStatus((st) => (st === "loading" || st === "error" ? "loading" : "offline"));
      const { data: r, error: roomErr } = await supabase.from("rooms").select().eq("code", code.toUpperCase()).maybeSingle();
      if (cancelled) return;
      if (roomErr) { setStatus("error"); return; }
      setRoom(r);
      if (!r) { setStatus("live"); return; }
      const id = r.id;
      const [m, l, t, a, n, p, c, k, sc] = await Promise.all([
        supabase.from("members").select().eq("room_id", id).order("created_at"),
        supabase.from("lines").select().eq("room_id", id).order("created_at"),
        supabase.from("translations").select("id, line_id, language, text, lines!inner(room_id)").eq("lines.room_id", id),
        supabase.from("agent_messages").select().eq("room_id", id).order("created_at"),
        supabase.from("notebook").select().eq("room_id", id).order("created_at"),
        supabase.from("photos").select().eq("room_id", id).order("created_at"),
        supabase.from("photo_captions").select("id, photo_id, language, caption, description, photos!inner(room_id)").eq("photos.room_id", id),
        supabase.from("cards").select().eq("room_id", id).order("created_at"),
        supabase.from("speaker_corrections").select().eq("room_id", id).order("created_at"),
      ]);
      if (cancelled) return;
      if ([m, l, a, n].some((x) => x.error)) { setStatus("error"); return; }
      setMembers(m.data ?? []);
      setLines(l.data ?? []);
      setTranslations((t.data ?? []).map(({ lines: _x, ...rest }) => rest));
      setAgentMessages(a.data ?? []);
      setNotebook(n.data ?? []);
      setPhotos(p.data ?? []);
      setCaptions((c.data ?? []).map(({ photos: _x, ...rest }) => rest));
      setCards(k.data ?? []);
      setCorrections(sc.data ?? []);
      const f = `room_id=eq.${id}`;
      channel = supabase
        .channel(`room-${id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${id}` }, (p) => {
          if (p.eventType !== "DELETE") setRoom(p.new as Room);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: f }, (p) => setMembers((x) => apply(x, p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "lines", filter: f }, (p) => setLines((x) => apply(x, p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "agent_messages", filter: f }, (p) => setAgentMessages((x) => apply(x, p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "notebook", filter: f }, (p) => setNotebook((x) => apply(x, p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: f }, (p) => setPhotos((x) => apply(x, p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "cards", filter: f }, (p) => setCards((x) => apply(x, p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "speaker_corrections", filter: f }, (p) => setCorrections((x) => apply(x, p)))
        .on("postgres_changes", { event: "*", schema: "public", table: "translations" }, (p) => {
          const row = (p.new ?? p.old) as Translation;
          if (p.eventType === "DELETE" || lineIds.current.has(row.line_id)) setTranslations((x) => apply(x, p));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "photo_captions" }, (p) => {
          const row = (p.new ?? p.old) as PhotoCaption;
          if (p.eventType === "DELETE" || photoIds.current.has(row.photo_id)) setCaptions((x) => apply(x, p));
        })
        .subscribe((st) => {
          if (cancelled) return;
          if (st === "SUBSCRIBED") setStatus("live");
          else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") setStatus("offline");
        });
    })().catch(() => { if (!cancelled) setStatus("error"); });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [code, nonce]);

  // The browser knows about lost Wi-Fi/cell long before the realtime heartbeat does. Coming back online,
  // waking the phone or returning to the tab reloads the room (catching up on anything missed) and resubscribes.
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const off = () => setStatus((st) => (st === "live" ? "offline" : st));
    const on = () => setNonce((n) => n + 1);
    const vis = () => {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); return; }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away > 3000) setNonce((n) => n + 1); // phones freeze sockets while asleep
    };
    const show = (e: PageTransitionEvent) => { if (e.persisted) setNonce((n) => n + 1); };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pageshow", show);
    };
  }, []);

  // Automatic retry with backoff (1s, 2s, 4s … 30s) while offline or after a failed load.
  const attempt = useRef(0);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  useEffect(() => {
    if (status === "live") { attempt.current = 0; setRetryIn(null); return; }
    if (status !== "offline" && status !== "error") return;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setRetryIn(null); return; } // "online" event will retry
    const delay = nextBackoff(attempt.current);
    attempt.current++;
    setRetryIn(delay);
    const t = setTimeout(() => setNonce((n) => n + 1), delay);
    return () => clearTimeout(t);
  }, [status, nonce]);

  /** Reloads the room and reconnects (used by "Try again" buttons). */
  const retry = () => setNonce((n) => n + 1);
  return { status, retryIn, retry, room, members, lines, translations, agentMessages, notebook, photos, captions, cards, corrections };
}

/** Reconnect delay for the n-th consecutive attempt: 1s, 2s, 4s, 8s, 16s, then 30s. */
export function nextBackoff(attempt: number) {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

export function useSignedUrls(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    const missing = paths.filter((p) => !urls[p]);
    if (!missing.length) return;
    supabase.storage
      .from("photos")
      .createSignedUrls(missing, 60 * 60 * 6)
      .then(({ data }) => {
        if (!data) return;
        setUrls((u) => {
          const n = { ...u };
          data.forEach((d) => d.path && d.signedUrl && (n[d.path] = d.signedUrl));
          return n;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* not allowed */
      }
    };
    req();
    const onVis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
