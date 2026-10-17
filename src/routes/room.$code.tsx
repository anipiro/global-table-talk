import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Headphones, Sparkles, Type, Camera, ImagePlus, History, Share2, Rows3, HelpCircle, Moon, X, ChevronUp, ChevronDown, Hand, Activity, AudioLines, BookOpen, MessagesSquare, Image as ImageIcon, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMemberId, inviteUrl, type Lang, type Line, type Member } from "@/lib/room";
import { fmtTime, useRoom, useSignedUrls, useWakeLock } from "@/lib/useRoom";
import { learnCorrection, loadLearning, unlockAudio, watchTalking, describePhoto, deviceLabel, generateRecap, listMics, micDeviceId, micSupported, playWhisper, requestCatchUp, setMicDebug, setMicDeviceId, startMic, stopMic } from "@/lib/agent";
import { classifyMicError, needsRecalibration } from "@/lib/crosstalk";
import { VoiceCalibration } from "@/components/JoinForm";
import { shareLink } from "@/lib/invites";
import { GuestList, InvitePanel } from "@/components/HostControls";
import { Screen } from "@/components/JoinForm";
import { ReassignSheet } from "@/components/Reassign";
import { Diagnostics } from "@/components/Diagnostics";
import { AgentFeed } from "@/components/AgentFeed";
import { NotebookSections } from "@/components/Notebook";
import { CardStack } from "@/components/CardStack";
import { renderBold } from "@/lib/richText";
import { PhotoGrid, PhotoViewer } from "@/components/Photos";
import { isGroupPhoto, sharePhoto } from "@/lib/photos";
import { LANGS } from "@/lib/room";

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

type Tab = "notebook" | "agents" | "photos" | "guests" | "diagnostics";
const TAB_ICONS: Record<Tab, typeof BookOpen> = { notebook: BookOpen, agents: MessagesSquare, photos: ImageIcon, guests: Users, diagnostics: Activity };

function RoomPage() {
  const { code } = Route.useParams();
  const nav = useNavigate();
  const data = useRoom(code);
  const { room, members, lines, translations, agentMessages, notebook, photos, captions, cards, corrections } = data;
  const meId = getMemberId(code);
  const me = members.find((m) => m.id === meId);
  const isHost = !!room && room.host_member_id === meId;
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  useWakeLock(true);

  const [big, setBigState] = useState(() => localStorage.getItem("gamige-big-text") === "1");
  const setBig = (v: boolean) => { setBigState(v); localStorage.setItem("gamige-big-text", v ? "1" : "0"); };
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micIssue, setMicIssue] = useState<"denied" | "disconnected" | "unsupported" | null>(null);
  const [holdMode, setHoldMode] = useState(() => localStorage.getItem("gamige-hold-to-talk") === "1");
  const [debugOn, setDebugOn] = useState(() => localStorage.getItem("gamige-debug-mic") === "1");
  const [debug, setDebug] = useState({ rms: 0, threshold: 0, dropped: 0 });
  const [recalibrating, setRecalibrating] = useState(false);
  const [fixLine, setFixLine] = useState<Line | null>(null);
  const [talking, setTalking] = useState<string[]>([]);
  const roomId = room?.id;
  // Learn from speaker fixes on lines this phone captured: moved to me = my voice; moved away = not my owner.
  useEffect(() => {
    if (!meId) return;
    const seen = new Set(loadLearning(meId).seen);
    for (const c of corrections) {
      if (c.undone_at || seen.has(c.id)) continue;
      const changed = ((c.changes as { line_id: string; from_speaker_id: string | null }[]) ?? []);
      for (const ch of changed) {
        const l = lines.find((x) => x.id === ch.line_id);
        if (!l || l.heard_by !== meId) continue;
        const was = ch.from_speaker_id === meId, now = c.to_speaker_id === meId;
        if (was !== now) learnCorrection(meId, c.id, l.loudness, now);
      }
    }
  }, [corrections, lines, meId]);
  useEffect(() => {
    if (!roomId) return;
    return watchTalking(roomId, (ids) => setTalking((prev) => (prev.join() === ids.join() ? prev : ids)));
  }, [roomId]);
  const [interim, setInterim] = useState("");
  const [tab, setTab] = useState<Tab>("notebook");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [streaming, setStreaming] = useState<string | null>(null);
  const [catchDone, setCatchDone] = useState(false);
  const [ending, setEnding] = useState(false);
  const groupInput = useRef<HTMLInputElement>(null);

  // "Nika shared a photo" for everyone else, with a button that opens it.
  const knownPhotos = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (data.status === "loading") return;
    if (!knownPhotos.current) { knownPhotos.current = new Set(photos.map((p) => p.id)); return; }
    for (const p of photos) {
      if (knownPhotos.current.has(p.id)) continue;
      knownPhotos.current.add(p.id);
      if (p.uploader_id === meId || isGroupPhoto(p.storage_path)) continue;
      const who = members.find((m) => m.id === p.uploader_id)?.name ?? "Someone";
      toast(`${who} shared a photo`, { action: { label: "Open", onClick: () => { setTab("photos"); setSheetOpen(true); setViewPhoto(p.id); } } });
    }
  }, [photos, data.status, meId, members]);

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

  const myCards = cards.filter((c) => c.member_id === me.id && !dismissed.has(c.id));

  async function micStart() {
    if (!me!.can_speak) { toast("The host has muted your mic"); return; }
    if (!micSupported(me!.language as Lang)) { setMicIssue("unsupported"); return; }
    // Uncalibrated phones (hosts, or anyone who skipped) can't tell their owner from the neighbour — ask once.
    if (!me!.voice_level && sessionStorage.getItem("gamige-calibration-skipped") !== me!.id) { setRecalibrating(true); return; }
    try {
      await startMic(me!, setInterim, (m) => {
        if (m === "__disconnected__") { setMicOn(false); setMicIssue("disconnected"); }
        else toast.error(m);
      });
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
    setCatchDone(false);
    setStreaming("");
    try {
      await requestCatchUp(me!.id, setStreaming);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Catch-up failed");
    } finally {
      setCatchDone(true);
    }
  }

  async function shareOne(file: File) {
    const t = toast.loading("Sharing your photo…");
    try {
      await sharePhoto(room!.id, me!.id, file);
      toast.success("Photo shared — your agents are describing it", { id: t });
      setTab("photos");
      setSheetOpen(true);
    } catch {
      toast.error("Couldn't upload the photo. Try again.", { id: t });
    }
  }

  /** Host: group photo → upload → recap generation starts → room ends, so everyone moves to the Recap
   *  screen right away and sees it fill in as the agents finish writing. */
  async function endNight(file?: File) {
    setEnding(true);
    const t = toast.loading(file ? "Saving the group photo…" : "Ending the night…");
    try {
      if (file) await sharePhoto(room!.id, me!.id, file, true);
      await stopMic();
      const recap = generateRecap(room!.id).catch(() => toast.error("The recap couldn't be written"));
      await supabase.from("rooms").update({ status: "ended" }).eq("id", room!.id);
      toast.dismiss(t);
      nav({ to: "/recap/$code", params: { code } });
      await recap;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't end the night", { id: t });
      setEnding(false);
    }
  }

  if (recalibrating)
    return (
      <Screen>
        <VoiceCalibration
          name={me.name}
          onDone={async (level) => {
            setRecalibrating(false);
            if (!level) sessionStorage.setItem("gamige-calibration-skipped", me.id);
            if (level) {
              await supabase.from("members").update({ voice_level: level, voice_calibrated_at: new Date().toISOString(), voice_device: deviceLabel() }).eq("id", me.id);
              toast.success("Voice calibrated — your phone will ignore quieter voices now");
            }
          }}
        />
      </Screen>
    );

  return (
    <div className={`px-safe flex h-dvh flex-col overflow-x-hidden ${big ? "text-[28px]" : "text-[20px]"}`}>
      {/* top bar */}
      <header className="z-20 border-b bg-background/95 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)] text-base backdrop-blur">
        {/* room identity row: code, who's here, live status */}
        <div className="flex min-w-0 items-center gap-2 pb-2 text-sm">
          <span className="shrink-0 font-display text-lg font-bold tracking-wide">Table {room.code}</span>
          <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-online" /> live
          </span>
          <span className="ml-auto flex items-center">
            {members.filter((m) => m.approved).slice(0, 6).map((m, i) => (
              <span key={m.id} className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-background text-[0.6rem] font-semibold text-primary-foreground"
                style={{ background: m.color, marginLeft: i ? -6 : 0, zIndex: 6 - i }} title={m.name}>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
            <span className="ml-2 text-xs text-muted-foreground">{members.filter((m) => m.approved).length} here</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
        <IconBtn
          label="Whisper in my headphones"
          active={me.whisper_on}
          onClick={() => {
            unlockAudio(); // must run inside the tap so iPhone Safari allows later playback
            void supabase.from("members").update({ whisper_on: !me.whisper_on }).eq("id", me.id).then(({ error }) => error && toast.error("Couldn't save whisper setting"));
          }}
        >
          <Headphones />
        </IconBtn>
        <button onClick={catchUp} disabled={streaming !== null && !catchDone} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-secondary px-3 font-semibold disabled:opacity-60">
          <Sparkles className="h-5 w-5 text-primary" /> Catch me up
        </button>
        <IconBtn label="Big text" active={big} onClick={() => setBig(!big)}>
          <Type />
        </IconBtn>
        </div>
      </header>
      {me.whisper_on && (
        <div className="flex justify-center border-b bg-background/95 py-1.5 text-sm">
          <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-0.5 text-primary">
            <Headphones className="h-3.5 w-3.5" /> Whispering in {LANGS.find((l) => l.id === me.language)?.label ?? me.language}
          </span>
        </div>
      )}

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
      {debugOn && !(sheetOpen && tab === "diagnostics") && (
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
        <CardStack big={big} cards={myCards} onDismiss={(id) => setDismissed((d) => new Set(d).add(id))} />
      </div>

      {streaming !== null && (
        <div className="fixed inset-0 z-50 flex items-end bg-background/60 backdrop-blur-sm" onClick={() => catchDone && setStreaming(null)}>
          <div role="dialog" aria-label="Catching you up" className="animate-sheet-up max-h-[70dvh] w-full overflow-y-auto rounded-t-3xl border-t bg-card p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="h-4 w-4" /> Your agent · catching you up</p>
              <button aria-label="Close" onClick={() => setStreaming(null)} className="rounded-full p-1 text-muted-foreground"><X className="h-5 w-5" /></button>
            </div>
            <p className="whitespace-pre-wrap text-xl leading-relaxed">
              {streaming ? renderBold(streaming) : "Thinking…"}
              {!catchDone && <span className="ml-1 inline-block h-5 w-2 animate-pulse rounded-sm bg-primary align-middle" />}
            </p>
          </div>
        </div>
      )}

      <Feed lines={lines} byId={byId} textFor={textFor} interim={micOn ? interim : ""} me={me} talking={talking} onFix={setFixLine} />
      {fixLine && <ReassignSheet line={fixLine} members={members} me={me} onClose={() => setFixLine(null)} />}

      {/* action row */}
      <div className="flex items-center gap-3 border-t px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto text-sm [&>*]:shrink-0">
        <PhotoButtons onFile={(f) => void shareOne(f)} />
        <Link to="/history/$code" params={{ code }} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2">
          <History className="h-4 w-4" /> History
        </Link>
        <Link to="/overlap/$code" params={{ code }} className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2">
          <Rows3 className="h-4 w-4" /> Who said what
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
      {/* mic sits at the bottom-right, under the thumb */}
        <button
          {...(holdMode
            ? { onPointerDown: () => void micStart(), onPointerUp: () => void micStop(), onPointerLeave: () => micOn && void micStop() }
            : { onClick: toggleMic })}
          aria-label={micOn ? "Stop mic" : holdMode ? "Hold to talk" : "Start mic"}
          disabled={!me.can_speak}
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full transition ${micOn ? "bg-primary text-primary-foreground shadow-[0_0_0_6px] shadow-primary/25" : "bg-secondary"} disabled:opacity-40`}
        >
          {micOn ? <Mic /> : holdMode ? <Hand /> : <MicOff />}
        </button>
      </div>

      {/* bottom sheet */}
      <section className={`pb-safe border-t bg-card transition-all ${big ? "text-[20px]" : "text-base"} ${sheetOpen ? "h-[55dvh]" : "h-14 box-content"}`}>
        <div className="flex h-14 items-center gap-1 px-2">
          {(["notebook", "agents", "photos", ...(isHost ? ["guests"] : []), ...(debugOn ? ["diagnostics"] : [])] as Tab[]).map((t) => {
            const pending = t === "guests" ? members.filter((m) => !m.approved).length : 0;
            const Icon = TAB_ICONS[t];
            return (
              <button key={t} onClick={() => { setTab(t); setSheetOpen(true); }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold capitalize ${sheetOpen && tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                <Icon className="h-4 w-4" aria-hidden />
                {t === "diagnostics" ? "Diag." : t}{pending > 0 && <span className="ml-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">{pending}</span>}
              </button>
            );
          })}
          <button aria-label="Toggle panel" onClick={() => setSheetOpen(!sheetOpen)} className="p-2 text-muted-foreground">
            {sheetOpen ? <ChevronDown /> : <ChevronUp />}
          </button>
        </div>
        {sheetOpen && (
          <div className={`h-[calc(55dvh-3.5rem)] px-4 ${tab === "agents" ? "overflow-hidden pb-2" : "overflow-y-auto pb-6"}`}>
            {tab === "notebook" && <NotebookSections entries={notebook} byId={byId} />}
            {tab === "agents" && <AgentFeed msgs={agentMessages} byId={byId} meId={me.id} status={data.status} retryIn={data.retryIn} onRetry={data.retry} />}
            {tab === "photos" && <PhotoGrid photos={photos} captions={captions} lang={me.language} onOpen={setViewPhoto} />}
            {tab === "diagnostics" && debugOn && <Diagnostics lines={lines} members={members} />}
            {tab === "guests" && isHost && (
              <div className="flex flex-col gap-6 pt-2">
                <GuestList room={room} members={members} />
                <InvitePanel room={room} me={me} />
              </div>
            )}
          </div>
        )}
      </section>
      {viewPhoto && photos.find((p) => p.id === viewPhoto) && (
        <PhotoViewer photo={photos.find((p) => p.id === viewPhoto)!} captions={captions} lang={me.language} byId={byId} onClose={() => setViewPhoto(null)} />
      )}
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

/** Chat-bubble caption feed: other people's lines sit on the left, mine on the right. Each bubble shows
 *  the original spoken text on top, a subtle divider, and the translation in my language underneath. */
function Feed({ lines, byId, textFor, interim, me, talking, onFix }: {
  lines: Line[]; byId: Map<string, Member>; textFor: (l: Line) => string | null; interim: string; me: Member; talking: string[]; onFix: (l: Line) => void;
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
        className="h-full overflow-y-auto px-3 py-4">
        {lines.length === 0 && <p className="mt-20 text-center text-muted-foreground">Tap the mic and start talking.<br />Captions appear here for everyone.</p>}
        <ul className="flex flex-col gap-4">
          {lines.map((l) => {
            const sp = byId.get(l.speaker_id ?? "");
            const mine = l.speaker_id === me.id;
            const tr = textFor(l);
            const orig = showOrig.has(l.id) || !tr;
            const pending = !tr && l.language !== me.language;
            const isTalking = !!sp && talking.includes(sp.id);
            return (
              <li key={l.id} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                {/* avatar chip in the speaker's color; glows while they're talking */}
                <span
                  className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground transition-shadow sm:h-9 sm:w-9 sm:text-sm ${isTalking ? "animate-pulse" : ""}`}
                  style={{ background: sp?.color ?? "var(--muted)", boxShadow: isTalking ? `0 0 0 3px ${sp!.color}55, 0 0 14px ${sp!.color}88` : undefined }}
                  aria-hidden
                >
                  {(sp?.name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div className={`flex min-w-0 max-w-[85%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  {l.ambiguous && (
                    <button onClick={() => onFix(l)} className="mb-1 flex items-center gap-1 rounded-full border border-primary/50 px-2 py-0.5 text-[0.55em] text-primary">
                      <HelpCircle className="h-3.5 w-3.5" /> Not sure who said this · tap to fix
                    </button>
                  )}
                  <button onClick={() => onFix(l)} aria-label={`Change speaker: ${sp?.name ?? "Unknown speaker"}`}
                    className={`mb-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-left text-[0.6em] font-semibold ${sp ? "" : "italic text-muted-foreground"}`} style={{ color: sp?.color }}>
                    {sp?.name ?? "Unknown speaker"}{l.ambiguous ? "?" : ""}
                    {sp && (
                      <span className="rounded-full border border-border bg-secondary px-1.5 py-px text-[0.85em] font-medium text-muted-foreground">
                        {sp.role === "talk" ? "Local" : sp.role === "follow" ? "Tourist" : "Local · Tourist"} · {sp.language.toUpperCase()}
                      </span>
                    )}
                    <span className="font-normal text-muted-foreground">{fmtTime(l.created_at)}</span>
                  </button>
                  <button
                    className={`block w-full rounded-3xl border px-4 py-3 text-left shadow-sm transition ${
                      mine
                        ? "rounded-br-md border-primary/30 bg-primary/15"
                        : "rounded-bl-md border-border bg-card"
                    } ${isTalking ? "ring-2 ring-speaking/60" : ""}`}
                    onClick={() => tr && setShowOrig((s) => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}
                  >
                    <p className={`break-words leading-snug ${pending ? "text-muted-foreground" : ""}`} style={{ fontWeight: 400 + Math.round(l.loudness * 3) * 100 }}>
                      {orig ? l.text : tr}
                    </p>
                    {tr && !showOrig.has(l.id) && (
                      <>
                        <hr className="my-2 border-border" />
                        <p className="break-words text-[0.8em] leading-snug text-muted-foreground">{l.text}</p>
                      </>
                    )}
                    {pending && <p className="mt-1 text-[0.55em] text-muted-foreground">translating…</p>}
                    {tr && showOrig.has(l.id) && <p className="mt-1 text-[0.55em] text-muted-foreground">original · tap for translation</p>}
                  </button>
                </div>
              </li>
            );
          })}
          {interim && (
            <li className="flex flex-row-reverse items-end gap-2 opacity-60">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-primary-foreground" style={{ background: me.color }} aria-hidden>
                {me.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="max-w-[82%] rounded-3xl rounded-br-md border border-primary/30 bg-primary/15 px-4 py-3">
                <p className="italic leading-snug">{interim}</p>
              </div>
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
  const input = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); };
  return (
    <>
      {/* no capture attribute: iPhone offers Photo Library or Take Photo */}
      <button onClick={() => input.current?.click()} className="flex min-h-11 items-center gap-1 rounded-full bg-secondary px-3 py-2"><ImagePlus className="h-4 w-4" /> Share a photo</button>
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} aria-label="Choose a photo" />
    </>
  );
}

