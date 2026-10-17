import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Headphones, Sparkles, Type, Camera, ImagePlus, History, Share2, Moon, X, ChevronUp, ChevronDown, Hand, Activity, AudioLines } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMemberId, inviteUrl, type Lang, type Line, type Member } from "@/lib/room";
import { fmtTime, useRoom, useSignedUrls, useWakeLock } from "@/lib/useRoom";
import { describePhoto, deviceLabel, generateRecap, listMics, micDeviceId, micSupported, playWhisper, requestCatchUp, setMicDebug, setMicDeviceId, startMic, stopMic } from "@/lib/agent";
import { classifyMicError, needsRecalibration } from "@/lib/crosstalk";
import { VoiceCalibration } from "@/components/JoinForm";
import { shareLink } from "@/lib/invites";
import { GuestList, InvitePanel } from "@/components/HostControls";
import { Screen } from "@/components/JoinForm";

export const Route = createFileRoute("/room/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "At the table — Gamige" },
      { name: "description", content: "Live captions, translations and your personal agent at the dinner table." },
      { property: "og:title", content: "At the table — Gamige" },
      { property: "og:description", content: "Live captions in your language." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RoomPage,
});

type Tab = "notebook" | "agents" | "photos" | "guests";

function RoomPage() {
  const { code } = Route.useParams();
  const nav = useNavigate();
  const data = useRoom(code);
  const { room, members, lines, translations, agentMessages, notebook, photos, captions, cards } = data;
  const meId = getMemberId(code);
  const me = members.find((m) => m.id === meId);
  const isHost = !!room && room.host_member_id === meId;
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  useWakeLock(true);

  const [big, setBig] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micIssue, setMicIssue] = useState<"denied" | "disconnected" | "unsupported" | null>(null);
  const [holdMode, setHoldMode] = useState(() => localStorage.getItem("gamige-hold-to-talk") === "1");
  const [debugOn, setDebugOn] = useState(() => localStorage.getItem("gamige-debug-mic") === "1");
  const [debug, setDebug] = useState({ rms: 0, threshold: 0, dropped: 0 });
  const [recalibrating, setRecalibrating] = useState(false);
  const [interim, setInterim] = useState("");
  const [tab, setTab] = useState<Tab>("notebook");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [streaming, setStreaming] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const groupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMicDebug(debugOn ? setDebug : null);
    return () => setMicDebug(null);
  }, [debugOn]);

  useEffect(() => {
    if (room?.status === "ended" && !ending) nav({ to: "/recap/$code", params: { code } });
  }, [room?.status, ending, code, nav]);

  // stop mic if host mutes me / on leave
  useEffect(() => {
    if (micOn && me && !me.can_speak) {
      stopMic();
      setMicOn(false);
      toast("The host turned off your mic");
    }
  }, [me?.can_speak, micOn, me]);
  useEffect(() => () => void stopMic(), []);

  // whisper translated lines from others
  const spoken = useRef<Set<string>>(new Set());
  const ready = useRef(false);
  useEffect(() => {
    if (!me) return;
    if (!ready.current) {
      translations.forEach((t) => spoken.current.add(t.id));
      ready.current = true;
      return;
    }
    for (const t of translations) {
      if (spoken.current.has(t.id)) continue;
      spoken.current.add(t.id);
      const line = lines.find((l) => l.id === t.line_id);
      if (me.whisper_on && t.language === me.language && line && line.speaker_id !== me.id) playWhisper(t.text, t.language);
    }
  }, [translations, lines, me]);

  if (room === undefined) return <Screen><p className="text-muted-foreground">Loading…</p></Screen>;
  if (!room) return <Screen><h1 className="text-3xl font-bold">Table not found</h1></Screen>;
  if (!me)
    return (
      <Screen>
        <h1 className="text-3xl font-bold">You're not at this table</h1>
        <p className="mt-2 text-muted-foreground">You may have been removed, or joined on another phone.</p>
        <Link to="/t/$code" params={{ code }} className="mt-6 text-primary">Join table {room.code}</Link>
      </Screen>
    );
  if (!me.approved || (room.status === "lobby" && !isHost))
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-6 h-16 w-16 animate-pulse rounded-full" style={{ background: me.color }} />
          <h1 className="text-3xl font-bold">{!me.approved ? "Waiting for the host" : "Almost time"}</h1>
          <p className="mt-3 text-lg text-muted-foreground">
            {!me.approved ? "They'll let you in shortly." : "The host will start the night soon."}
          </p>
        </div>
      </Screen>
    );

  const textFor = (l: Line) =>
    l.language === me.language ? null : translations.find((t) => t.line_id === l.id && t.language === me.language)?.text ?? null;

  const myCards = cards.filter((c) => c.member_id === me.id && c.kind !== "recap" && !dismissed.has(c.id));

  async function micStart() {
    if (!me!.can_speak) { toast("The host has muted your mic"); return; }
    if (!micSupported(me!.language as Lang)) { setMicIssue("unsupported"); return; }
    try {
      await startMic(me!, setInterim, (m) => toast.error(m));
      setMicOn(true);
      setMicIssue(null);
    } catch (e) {
      const kind = classifyMicError(e);
      setMicIssue(kind === "unknown" ? "disconnected" : kind);
    }
  }

  async function micStop() {
    await stopMic();
    setMicOn(false);
    setInterim("");
  }

  async function toggleMic() {
    if (micOn) return micStop();
    return micStart();
  }

  async function recalibrate() {
    setRecalibrating(true);
  }

  async function catchUp() {
    setStreaming("");
    try {
      await requestCatchUp(me!.id, setStreaming);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Catch-up failed");
    } finally {
      setTimeout(() => setStreaming(null), 1200);
    }
  }

  async function uploadPhoto(file: File, group = false) {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${room!.id}/${group ? "group-" : ""}${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("photos").upload(path, file, { contentType: file.type });
    if (error) throw error;
    const { data, error: e2 } = await supabase.from("photos").insert({ room_id: room!.id, uploader_id: me!.id, storage_path: path }).select().single();
    if (e2) throw e2;
    describePhoto(data.id).catch((e) => toast.error(e.message));
    return data;
  }

  async function endNight(file?: File) {
    setEnding(true);
    const t = toast.loading("Writing everyone's recap…");
    try {
      if (file) await uploadPhoto(file, true);
      await stopMic();
      await generateRecap(room!.id).catch((e) => toast.error(e.message));
      await supabase.from("rooms").update({ status: "ended" }).eq("id", room!.id);
      nav({ to: "/recap/$code", params: { code } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't end the night");
      setEnding(false);
    } finally {
      toast.dismiss(t);
    }
  }

  if (recalibrating)
    return (
      <Screen>
        <VoiceCalibration
          name={me.name}
          onDone={async (level) => {
            setRecalibrating(false);
            if (level) {
              await supabase.from("members").update({ voice_level: level, voice_calibrated_at: new Date().toISOString(), voice_device: deviceLabel() }).eq("id", me.id);
              toast.success("Voice calibrated — your phone will ignore quieter voices now");
            }
          }}
        />
      </Screen>
    );

  return (
    <div className={`flex h-dvh flex-col ${big ? "text-[28px]" : "text-[20px]"}`}>
      {/* top bar */}
      <header className="z-20 flex items-center gap-2 border-b bg-background/95 px-3 py-3 text-base backdrop-blur">
        <button
          {...(holdMode
            ? { onPointerDown: () => void micStart(), onPointerUp: () => void micStop(), onPointerLeave: () => micOn && void micStop() }
            : { onClick: toggleMic })}
          aria-label={micOn ? "Stop mic" : holdMode ? "Hold to talk" : "Start mic"}
          disabled={!me.can_speak}
          className={`flex h-14 w-14 items-center justify-center rounded-full transition ${micOn ? "bg-primary text-primary-foreground shadow-[0_0_0_6px] shadow-primary/25" : "bg-secondary"} disabled:opacity-40`}
        >
          {micOn ? <Mic /> : holdMode ? <Hand /> : <MicOff />}
        </button>
        <IconBtn
          label="Whisper in my headphones"
          active={me.whisper_on}
          onClick={() => supabase.from("members").update({ whisper_on: !me.whisper_on }).eq("id", me.id)}
        >
          <Headphones />
        </IconBtn>
        <button onClick={catchUp} disabled={streaming !== null} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-secondary px-3 font-semibold disabled:opacity-60">
          <Sparkles className="h-5 w-5 text-primary" /> Catch me up
        </button>
        <IconBtn label="Big text" active={big} onClick={() => setBig(!big)}>
          <Type />
        </IconBtn>
      </header>

      {/* mic recovery states */}
      {micIssue && (
        <MicIssueBanner
          kind={micIssue}
          onRetry={() => void micStart()}
          onClose={() => setMicIssue(null)}
        />
      )}
      {!micIssue && needsRecalibration(me, deviceLabel()) && !recalibrating && (
        <button onClick={recalibrate} className="flex items-center gap-2 border-b bg-secondary px-4 py-2 text-left text-sm">
          <AudioLines className="h-4 w-4 shrink-0 text-primary" />
          {me.voice_level ? "You seem to be on a different phone — recalibrate your voice" : "Calibrate your voice so your phone ignores the neighbours"}
        </button>
      )}

      {/* debug overlay */}
      {debugOn && (
        <div className="pointer-events-none fixed bottom-40 left-3 z-40 rounded-2xl bg-background/90 p-3 font-mono text-xs shadow-lg backdrop-blur">
          <p>RMS {debug.rms.toFixed(4)}</p>
          <p>threshold {debug.threshold ? debug.threshold.toFixed(4) : "off"}</p>
          <p>dropped {debug.dropped}</p>
          <div className="mt-1 h-2 w-32 overflow-hidden rounded-full bg-secondary">
            <div className={`h-full ${debug.threshold && debug.rms < debug.threshold ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, debug.rms * 400)}%` }} />
          </div>
        </div>
      )}

      {/* private cards */}
      <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex flex-col gap-2 px-3">
        {streaming !== null && (
          <div className="animate-slide-down pointer-events-auto rounded-3xl border border-primary/40 bg-card p-4 text-lg shadow-xl">
            <p className="mb-1 text-sm font-semibold text-primary">Your agent · catching you up</p>
            <p className="whitespace-pre-wrap">{streaming || "Thinking…"}</p>
          </div>
        )}
        {streaming === null && myCards.slice(-2).map((c) => (
          <div key={c.id} className="animate-slide-down pointer-events-auto relative rounded-3xl border bg-card p-4 pr-12 text-lg shadow-xl">
            <p className="mb-1 text-sm font-semibold text-primary">{c.title}</p>
            <p className="whitespace-pre-wrap">{c.body}</p>
            <button aria-label="Dismiss" onClick={() => setDismissed(new Set(dismissed).add(c.id))} className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        ))}
      </div>

      <Feed lines={lines} byId={byId} textFor={textFor} interim={micOn ? interim : ""} me={me} />

      {/* action row */}
      <div className="flex gap-2 overflow-x-auto whitespace-nowrap border-t px-3 py-2 text-sm [&>*]:shrink-0">
        <PhotoButtons onFile={(f) => uploadPhoto(f).then(() => toast.success("Photo shared")).catch(() => toast.error("Upload failed"))} />
        <Link to="/history/$code" params={{ code }} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2">
          <History className="h-4 w-4" /> History
        </Link>
        <button onClick={() => shareLink(inviteUrl(room.code)).then((r) => r === "copied" && toast.success("Table link copied"))} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2" aria-label="Invite">
          <Share2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => { const v = !holdMode; setHoldMode(v); localStorage.setItem("gamige-hold-to-talk", v ? "1" : "0"); if (!v && micOn) void micStop(); }}
          aria-pressed={holdMode}
          className={`flex items-center gap-1 rounded-full px-3 py-2 ${holdMode ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
        >
          <Hand className="h-4 w-4" /> Hold to talk
        </button>
        <button
          onClick={() => { const v = !debugOn; setDebugOn(v); localStorage.setItem("gamige-debug-mic", v ? "1" : "0"); }}
          aria-pressed={debugOn}
          className={`flex items-center gap-1 rounded-full px-3 py-2 ${debugOn ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
          aria-label="Mic debug overlay"
        >
          <Activity className="h-4 w-4" />
        </button>
        <button onClick={recalibrate} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2" aria-label="Recalibrate my voice">
          <AudioLines className="h-4 w-4" />
        </button>
        {isHost && (
          <>
            <button disabled={ending} onClick={() => groupInput.current?.click()} className="ml-auto flex items-center gap-1 rounded-full border border-primary/50 px-3 py-2 text-primary">
              <Moon className="h-4 w-4" /> End the night
            </button>
            <input ref={groupInput} type="file" accept="image/*" capture="user" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) endNight(f);
              else if (confirm("End without a group photo?")) endNight();
            }} />
          </>
        )}
      </div>

      {/* bottom sheet */}
      <section className={`border-t bg-card text-base transition-all ${sheetOpen ? "h-[55dvh]" : "h-14"}`}>
        <div className="flex h-14 items-center gap-1 px-2">
          {(["notebook", "agents", "photos", ...(isHost ? ["guests"] : [])] as Tab[]).map((t) => {
            const pending = t === "guests" ? members.filter((m) => !m.approved).length : 0;
            return (
              <button key={t} onClick={() => { setTab(t); setSheetOpen(true); }}
                className={`flex-1 rounded-full py-2 font-semibold capitalize ${sheetOpen && tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {t}{pending > 0 && <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">{pending}</span>}
              </button>
            );
          })}
          <button aria-label="Toggle panel" onClick={() => setSheetOpen(!sheetOpen)} className="p-2 text-muted-foreground">
            {sheetOpen ? <ChevronDown /> : <ChevronUp />}
          </button>
        </div>
        {sheetOpen && (
          <div className="h-[calc(55dvh-3.5rem)] overflow-y-auto px-4 pb-6">
            {tab === "notebook" && <NotebookTab entries={notebook} />}
            {tab === "agents" && <AgentsTab msgs={agentMessages} byId={byId} />}
            {tab === "photos" && <PhotosTab photos={photos} captions={captions} lang={me.language} />}
            {tab === "guests" && isHost && (
              <div className="flex flex-col gap-6 pt-2">
                <GuestList room={room} members={members} />
                <InvitePanel room={room} me={me} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function MicIssueBanner({ kind, onRetry, onClose }: { kind: "denied" | "disconnected" | "unsupported"; onRetry: () => void; onClose: () => void }) {
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  useEffect(() => {
    if (kind === "disconnected") listMics().then(setMics).catch(() => {});
  }, [kind]);
  const text =
    kind === "denied"
      ? "Microphone permission was denied. Allow it in your browser settings, then retry."
      : kind === "disconnected"
        ? "The microphone disappeared or is busy (another app, or it was unplugged)."
        : "This browser doesn't support live captions. Use Chrome, Edge or Safari.";
  return (
    <div className="flex flex-col gap-2 border-b bg-destructive/15 px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p>{text}</p>
        <button onClick={onClose} aria-label="Dismiss"><X className="h-4 w-4" /></button>
      </div>
      {kind !== "unsupported" && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onRetry} className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground">Retry</button>
          {mics.length > 1 && (
            <select
              value={micDeviceId() ?? ""}
              onChange={(e) => { setMicDeviceId(e.target.value || null); onRetry(); }}
              className="rounded-full bg-secondary px-3 py-2"
              aria-label="Choose microphone"
            >
              <option value="">Default microphone</option>
              {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, label, active, onClick }: { children: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button aria-label={label} aria-pressed={active} onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-full ${active ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
      {children}
    </button>
  );
}

function Feed({ lines, byId, textFor, interim, me }: {
  lines: Line[]; byId: Map<string, Member>; textFor: (l: Line) => string | null; interim: string; me: Member;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [showOrig, setShowOrig] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (atBottom) ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [lines.length, interim, atBottom]);
  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={ref} onScroll={(e) => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60); }}
        className="h-full overflow-y-auto px-4 py-6">
        {lines.length === 0 && <p className="mt-20 text-center text-muted-foreground">Tap the mic and start talking.<br />Captions appear here for everyone.</p>}
        <ul className="flex flex-col gap-5">
          {lines.map((l) => {
            const sp = byId.get(l.speaker_id ?? "");
            const tr = textFor(l);
            const orig = showOrig.has(l.id) || !tr;
            const pending = !tr && l.language !== me.language;
            return (
              <li key={l.id}>
                <button className="w-full text-left" onClick={() => tr && setShowOrig((s) => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}>
                  <p className="text-[0.7em] font-semibold" style={{ color: sp?.color }}>{sp?.name ?? "Someone"} <span className="font-normal text-muted-foreground">· {fmtTime(l.created_at)}</span></p>
                  <p className={`leading-snug ${pending ? "text-muted-foreground" : ""}`} style={{ fontWeight: 400 + Math.round(l.loudness * 3) * 100 }}>
                    {orig ? l.text : tr}
                  </p>
                  {pending && <p className="text-[0.6em] text-muted-foreground">translating…</p>}
                  {tr && showOrig.has(l.id) && <p className="text-[0.6em] text-muted-foreground">original · tap for translation</p>}
                </button>
              </li>
            );
          })}
          {interim && (
            <li className="opacity-60">
              <p className="text-[0.7em] font-semibold" style={{ color: me.color }}>{me.name}</p>
              <p className="italic">{interim}</p>
            </li>
          )}
        </ul>
      </div>
      {!atBottom && (
        <button onClick={() => { setAtBottom(true); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-primary px-5 py-2 text-base font-semibold text-primary-foreground shadow-lg">
          Jump to live ↓
        </button>
      )}
    </div>
  );
}

function PhotoButtons({ onFile }: { onFile: (f: File) => void }) {
  const gal = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); };
  return (
    <>
      <button onClick={() => cam.current?.click()} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2" aria-label="Take a photo"><Camera className="h-4 w-4" /></button>
      <button onClick={() => gal.current?.click()} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2"><ImagePlus className="h-4 w-4" /> Share a photo</button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={pick} />
    </>
  );
}

const KIND_LABEL: Record<string, string> = { person: "People", glossary: "Words", decision: "Plans", moment: "Moments" };
function NotebookTab({ entries }: { entries: ReturnType<typeof useRoom>["notebook"] }) {
  if (!entries.length) return <p className="pt-4 text-muted-foreground">The agents will jot down people, words and plans here.</p>;
  return (
    <div className="flex flex-col gap-5 pt-2">
      {Object.keys(KIND_LABEL).map((k) => {
        const list = entries.filter((e) => e.kind === k);
        if (!list.length) return null;
        return (
          <div key={k}>
            <h3 className="mb-2 text-sm uppercase tracking-widest text-muted-foreground">{KIND_LABEL[k]}</h3>
            <div className="flex flex-col gap-2">
              {list.map((e) => (
                <div key={e.id} className="rounded-2xl bg-secondary p-3">
                  <p className="font-semibold">{e.title}</p>
                  {e.body && <p className="text-muted-foreground">{e.body}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentsTab({ msgs, byId }: { msgs: ReturnType<typeof useRoom>["agentMessages"]; byId: Map<string, Member> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: "end" }), [msgs.length]);
  if (!msgs.length) return <p className="pt-4 text-muted-foreground">Agents talk to each other here.</p>;
  return (
    <div ref={ref} className="flex flex-col gap-3 pt-2">
      {msgs.map((m) => {
        const from = byId.get(m.from_member_id ?? "");
        const to = m.to_member_id ? byId.get(m.to_member_id) : null;
        return (
          <div key={m.id} className="rounded-2xl rounded-tl-sm bg-secondary p-3" style={{ borderLeft: `4px solid ${from?.color ?? "transparent"}` }}>
            <p className="text-sm text-muted-foreground">
              <span style={{ color: from?.color }}>{from?.name ?? "An"}'s agent</span>
              {" → "}
              {to ? <span style={{ color: to.color }}>{to.name}'s agent</span> : "everyone"}
              <span className="ml-2 rounded-full border px-2 text-xs">{m.type}</span>
            </p>
            <p className="mt-1">{m.content}</p>
          </div>
        );
      })}
    </div>
  );
}

function PhotosTab({ photos, captions, lang }: { photos: ReturnType<typeof useRoom>["photos"]; captions: ReturnType<typeof useRoom>["captions"]; lang: string }) {
  const urls = useSignedUrls(photos.map((p) => p.storage_path));
  if (!photos.length) return <p className="pt-4 text-muted-foreground">Share a photo and your agents will describe it for everyone.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      {photos.map((p) => {
        const c = captions.find((x) => x.photo_id === p.id && x.language === lang);
        return (
          <figure key={p.id} className="overflow-hidden rounded-2xl bg-secondary">
            {urls[p.storage_path] ? <img src={urls[p.storage_path]} alt={c?.caption ?? "Shared photo"} className="aspect-square w-full object-cover" /> : <div className="aspect-square" />}
            <figcaption className="p-2 text-sm">{c ? <><b>{c.caption}</b><br /><span className="text-muted-foreground">{c.description}</span></> : <span className="text-muted-foreground">Describing…</span>}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
