import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Headphones, Type, ImagePlus, History, Share2, Rows3, HelpCircle, Moon, X, ChevronUp, Hand, AudioLines, BookOpen, MessagesSquare, Image as ImageIcon, Users, Activity, Ellipsis, ArrowDown } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/room/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "At the table — Gamige" },
      { name: "description", content: "Live captions and translation with speaker names, plus your personal agent." },
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
  const { room, members, lines, translations, agentMessages, notebook, photos, captions, cards, corrections, media } = data;
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
  if (!room) return <Screen><h1 className="text-3xl font-semibold">Table not found</h1></Screen>;
  if (!me)
    return (
      <Screen>
        <h1 className="text-3xl font-semibold">You're not at this table</h1>
        <p className="mt-2 text-muted-foreground">You may have been removed, or joined on another phone.</p>
        <Link to="/t/$code" params={{ code }} className={buttonVariants({ variant: "outline", className: "mt-6 self-start" })}>Join table {room.code}</Link>
      </Screen>
    );
  if (!me.approved || (room.status === "lobby" && !isHost))
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-6 size-16 animate-pulse rounded-full" style={{ background: me.color }} />
          <h1 className="text-3xl font-semibold">{!me.approved ? "Waiting for the host" : "Almost time"}</h1>
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
      toast.success("Photo shared. Your agents are describing it.", { id: t });
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
              toast.success("Voice calibrated. Your phone will now ignore quieter voices.");
            }
          }}
        />
      </Screen>
    );

  const tabList = ["notebook", "agents", "photos", ...(isHost ? ["guests"] : []), ...(debugOn ? ["diagnostics"] : [])] as Tab[];
  return (
    <div className={`px-safe h-dvh overflow-x-hidden ${big ? "text-[28px]" : "text-[20px]"}`}>
      {/* The room fills the whole page at every width. The side gutter grows with the screen (16px on a phone, 24px from 640px,
          48px from 1024px) so the content keeps comfortable margins. */}
      <div className="flex h-full w-full flex-col">
      {/* top bar */}
      <header className="z-20 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] text-base sm:px-6 sm:pt-5 lg:px-12">
        {/* room identity row: code, live status, who's here (the person talking bobs and gets a pulsing ring) */}
        <div className="flex min-w-0 items-center gap-3 pb-3">
          <h1 className="shrink-0 whitespace-nowrap font-display text-[34px] leading-none">Table {room.code}</h1>
          <span className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <span className="relative size-2.5" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-online" />
              <span className="absolute inset-0 animate-ping rounded-full bg-online opacity-60" />
            </span>
            Live
          </span>
          <span className="ml-auto flex shrink-0 items-center">
            {members.filter((m) => m.approved).slice(0, 6).map((m, i) => (
              <span key={m.id} className={`relative grid size-8 place-items-center rounded-full text-xs font-extrabold text-foreground ring-[3px] ring-background ${talking.includes(m.id) ? "is-talking" : ""}`}
                style={{ background: `color-mix(in oklab, ${m.color} 85%, var(--background))`, marginLeft: i ? -6 : 0, zIndex: 6 - i }} title={talking.includes(m.id) ? `${m.name} is speaking` : m.name}>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
            <span className="ml-2.5 whitespace-nowrap text-sm font-semibold text-muted-foreground">{members.filter((m) => m.approved).length} here</span>
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
          <Button variant="outline" className="flex-1" onClick={catchUp} disabled={streaming !== null && !catchDone}>
            Catch me up
          </Button>
          <IconBtn label="Big text" active={big} onClick={() => setBig(!big)}>
            <Type />
          </IconBtn>
        </div>
      </header>
      {me.whisper_on && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-card px-3 py-2 text-sm sm:mx-6 lg:mx-12">
          <Headphones className="size-4 text-muted-foreground" aria-hidden /> Whispering in {LANGS.find((l) => l.id === me.language)?.label ?? me.language}
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
        <button onClick={recalibrate} className="mx-4 mb-2 flex min-h-11 items-center gap-2 rounded-xl bg-card px-4 py-2 text-left text-sm sm:mx-6 lg:mx-12">
          <AudioLines className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {me.voice_level ? "You seem to be on a different phone. Recalibrate your voice." : "Calibrate your voice so your phone ignores the neighbours"}
        </button>
      )}

      {/* debug overlay */}
      {debugOn && !(sheetOpen && tab === "diagnostics") && (
        <div className="pointer-events-none fixed bottom-40 left-3 z-40 rounded-lg border bg-background p-3 font-mono text-xs">
          <p>RMS {debug.rms.toFixed(4)}</p>
          <p>threshold {debug.threshold ? debug.threshold.toFixed(4) : "off"}</p>
          <p>dropped {debug.dropped}</p>
          <div className="mt-1 h-2 w-32 overflow-hidden rounded-sm bg-secondary">
            <div className={`h-full ${debug.threshold && debug.rms < debug.threshold ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, debug.rms * 400)}%` }} />
          </div>
        </div>
      )}

      {/* private cards: in the page flow, so the feed gets shorter instead of being covered */}
      {myCards.length > 0 && (
        <div className="flex max-h-[40dvh] shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden px-4 py-2 sm:px-6 lg:px-12">
          <CardStack big={big} cards={myCards} onDismiss={(id) => setDismissed((d) => new Set(d).add(id))} />
        </div>
      )}

      {streaming !== null && (
        <div className="fixed inset-0 z-50 flex items-end bg-background/80" onClick={() => catchDone && setStreaming(null)}>
          <div role="dialog" aria-label="Catching you up" className="animate-sheet-up mx-auto max-h-[70dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-sheet p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-muted-foreground">Catch-up for you</p>
              <button aria-label="Close" onClick={() => setStreaming(null)} className="-mr-2 flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent"><X className="size-5" /></button>
            </div>
            <p className="whitespace-pre-wrap text-xl">
              {streaming ? renderBold(streaming) : "Writing your catch-up…"}
              {!catchDone && <span className="ml-1 inline-block h-5 w-2 animate-pulse rounded-sm bg-brown align-middle" />}
            </p>
          </div>
        </div>
      )}

      <Feed lines={lines} byId={byId} textFor={textFor} interim={micOn ? interim : ""} me={me} micOn={micOn} onFix={setFixLine} />
      {fixLine && <ReassignSheet line={fixLine} members={members} me={me} onClose={() => setFixLine(null)} />}

      {/* action row: the two things you reach for most, everything else under More, the mic under the thumb */}
      <div className="flex items-center gap-2 px-4 py-3 sm:px-6 sm:py-4 lg:px-12">
        <PhotoButtons onFile={(f) => void shareOne(f)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary"><Ellipsis aria-hidden /> More</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-64">
            <DropdownMenuItem asChild>
              <Link to="/history/$code" params={{ code }}><History aria-hidden /> History</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/overlap/$code" params={{ code }}><Rows3 aria-hidden /> Who said what</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void shareLink(inviteUrl(room.code)).then((r) => r === "copied" && toast.success("Table link copied"))}>
              <Share2 aria-hidden /> Invite link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={holdMode}
              onCheckedChange={(v) => { setHoldMode(v); localStorage.setItem("gamige-hold-to-talk", v ? "1" : "0"); if (!v && micOn) void micStop(); }}
            >
              <Hand aria-hidden /> Hold to talk
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={debugOn}
              onCheckedChange={(v) => { setDebugOn(v); localStorage.setItem("gamige-debug-mic", v ? "1" : "0"); }}
            >
              <Activity aria-hidden /> Mic debug overlay
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={recalibrate}>
              <AudioLines aria-hidden /> Recalibrate voice
            </DropdownMenuItem>
            {isHost && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={ending} onSelect={() => groupInput.current?.click()} className="text-destructive focus:text-destructive">
                  <Moon aria-hidden /> End the night
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {isHost && (
          <input ref={groupInput} type="file" accept="image/*" capture="user" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) endNight(f);
            else if (confirm("End without a group photo?")) endNight();
          }} />
        )}
        {/* mic sits at the bottom-right, under the thumb */}
        <button
          {...(holdMode
            ? { onPointerDown: () => void micStart(), onPointerUp: () => void micStop(), onPointerLeave: () => micOn && void micStop() }
            : { onClick: toggleMic })}
          aria-label={micOn ? "Stop mic" : holdMode ? "Hold to talk" : "Start mic"}
          data-on={micOn}
          disabled={!me.can_speak}
          className={`mic-btn ml-auto grid size-[76px] shrink-0 place-items-center rounded-full border-2 [&_svg]:relative [&_svg]:z-10 [&_svg]:size-8 disabled:cursor-not-allowed disabled:border-border disabled:bg-secondary disabled:text-muted-foreground ${micOn ? "border-terracotta bg-terracotta text-cream" : "border-input bg-card text-foreground"}`}
        >
          <span className="mic-pulse" aria-hidden />
          <span className="mic-pulse" aria-hidden />
          <span className="mic-wave" aria-hidden>
            {Array.from({ length: 28 }, (_, i) => <i key={i} style={{ "--ang": `${(i * 360) / 28}deg`, "--k": i } as React.CSSProperties} />)}
          </span>
          {micOn ? <Mic /> : holdMode ? <Hand /> : <MicOff />}
        </button>
      </div>

      {/* bottom sheet */}
      <section className={`flex flex-col-reverse ${big ? "text-[20px]" : "text-base"}`}>
        <div className="bg-brown pb-safe">
        <div className="flex h-14 shrink-0 items-stretch px-2 py-1.5 sm:px-5 lg:px-11">
          <div className="relative flex min-w-0 flex-1 items-stretch gap-0.5" style={{ "--n": tabList.length, "--i": Math.max(0, tabList.indexOf(tab)) } as React.CSSProperties}>
          <span data-tab-indicator aria-hidden="true" className={`tab-indicator ${sheetOpen ? "opacity-100" : "opacity-0"}`} />
          {tabList.map((t) => {
            const pending = t === "guests" ? members.filter((m) => !m.approved).length : 0;
            const Icon = TAB_ICONS[t];
            const active = sheetOpen && tab === t;
            return (
              <button key={t} onClick={() => { setTab(t); setSheetOpen(true); }} aria-pressed={active}
                className={`relative z-10 flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold capitalize transition-colors duration-300 ${active ? "text-foreground" : "text-cream-2 hover:bg-cream/10"}`}>
                <Icon className="size-5" aria-hidden />
                {t === "diagnostics" ? "Diag." : t}
                {pending > 0 && <span className="absolute right-1/4 top-0 min-w-5 rounded-full bg-terracotta px-1.5 text-center text-xs font-bold text-cream ring-2 ring-brown">{pending}</span>}
              </button>
            );
          })}
          </div>
          <button aria-label="Toggle panel" aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)} className="ml-0.5 flex min-h-11 w-12 shrink-0 items-center justify-center self-center rounded-2xl text-cream-2 hover:text-cream">
            <ChevronUp className={`transition-transform duration-500 ease-out motion-reduce:transition-none ${sheetOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
        </div>
        <SheetPanel open={sheetOpen}>
          <div className="h-[calc(40dvh-3.5rem)] shrink-0 overflow-hidden rounded-t-3xl bg-sheet px-5 pt-5 sm:px-6 lg:px-12">
            <TabSwap
              tab={tab}
              render={(t) => (
                <>
                  {t === "notebook" && <NotebookSections entries={notebook} byId={byId} media={media} lang={me.language} />}
                  {t === "agents" && <AgentFeed msgs={agentMessages} byId={byId} meId={me.id} status={data.status} retryIn={data.retryIn} onRetry={data.retry} />}
                  {t === "photos" && <PhotoGrid photos={photos} captions={captions} lang={me.language} onOpen={setViewPhoto} />}
                  {t === "diagnostics" && debugOn && <Diagnostics lines={lines} members={members} />}
                  {t === "guests" && isHost && (
                    <div className="flex flex-col gap-6 pt-2">
                      <GuestList room={room} members={members} />
                      <InvitePanel room={room} me={me} />
                    </div>
                  )}
                </>
              )}
            />
          </div>
        </SheetPanel>
      </section>
      </div>
      {viewPhoto && photos.find((p) => p.id === viewPhoto) && (
        <PhotoViewer photo={photos.find((p) => p.id === viewPhoto)!} captions={captions} lang={me.language} byId={byId} onClose={() => setViewPhoto(null)} />
      )}
    </div>
  );
}

/**
 * Opens and closes the bottom sheet smoothly. Mounting it in place made the whole page jump by the sheet's height in one frame
 * and closing it had no animation at all. Now the row's height eases between 0 and its natural height (grid-template-rows 0fr to 1fr,
 * 0.5s), the content fades in step with it, and on close the sheet stays mounted until the easing has finished. Content is anchored
 * to the top edge, so it travels with the edge like a drawer. A forced style calculation between the collapsed and the expanded
 * state (in the layout effect) is what lets the opening transition run. With reduced motion it opens and closes instantly.
 */
function SheetPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setExpanded(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), 520);
    return () => window.clearTimeout(id);
  }, [open]);
  useLayoutEffect(() => {
    if (!mounted || !open || expanded) return;
    // The panel is in the DOM collapsed. Reading its box makes the browser compute that collapsed style now, so switching to the
    // expanded style in the same task starts a transition from it instead of appearing at full height.
    void box.current?.getBoundingClientRect();
    setExpanded(true);
  }, [mounted, open, expanded]);
  if (!mounted) return null;
  return (
    <div
      ref={box}
      className="grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      aria-hidden={!open}
    >
      <div className={`min-h-0 overflow-hidden transition-opacity duration-300 motion-reduce:transition-none ${expanded ? "opacity-100" : "opacity-0"}`}>{children}</div>
    </div>
  );
}

/**
 * Swaps the bottom sheet's content when the tab changes: the old panel fades and lifts away (the .tab-leave animation is 140ms;
 * the swap waits 170ms so it never cuts the fade short), then the new one rises in (.tab-enter). The panel is a fixed-size, keyed box, so every tab has the
 * same width and starts at the top, and the padding and scroll mode never change under an open sheet. It mounts only while
 * the sheet is open, so opening it never flashes the previous tab. With reduced motion the swap is immediate.
 */
function TabSwap({ tab, render }: { tab: Tab; render: (t: Tab) => React.ReactNode }) {
  const [shown, setShown] = useState<Tab>(tab);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (tab === shown) {
      setLeaving(false);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(tab);
      return;
    }
    setLeaving(true);
    const id = window.setTimeout(() => {
      setShown(tab);
      setLeaving(false);
    }, 170);
    return () => window.clearTimeout(id);
  }, [tab, shown]);
  return (
    <div
      key={shown}
      className={`h-full [scrollbar-gutter:stable] ${shown === "agents" ? "overflow-hidden pb-2" : "overflow-y-auto pb-6"} ${leaving ? "tab-leave" : "tab-enter"}`}
    >
      {render(shown)}
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
    <div className="flex flex-col gap-2 border-b border-destructive bg-card px-4 py-3 text-base sm:px-6 lg:px-12">
      <div className="flex items-start justify-between gap-2">
        <p>{text}</p>
        <button onClick={onClose} aria-label="Dismiss" className="-mr-3 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>
      </div>
      {kind !== "unsupported" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onRetry}>Retry</Button>
          {mics.length > 1 && (
            <select
              value={micDeviceId() ?? ""}
              onChange={(e) => { setMicDeviceId(e.target.value || null); onRetry(); }}
              className="min-h-11 rounded-lg border-2 border-input bg-card px-3"
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
      className={`flex size-11 shrink-0 items-center justify-center rounded-xl border-2 transition-transform active:scale-95 ${active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`}>
      {children}
    </button>
  );
}

/** Transcript of the table, set like film subtitles: the newest line is the biggest and older lines step down.
 *  Each line is one unit: a thread and a name chip in the speaker's colour, the line in my language and,
 *  underneath in muted text, what was actually said. A line that arrives live fades in word by word. */
function Feed({ lines, byId, textFor, interim, me, micOn, onFix }: {
  lines: Line[]; byId: Map<string, Member>; textFor: (l: Line) => string | null; interim: string; me: Member; micOn: boolean; onFix: (l: Line) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // The bottom sheet opening or closing resizes this feed. If the reader is at the newest line, keep it in view through every frame of
  // the resize, so it neither slides out of sight nor needs a jump afterwards. Someone who scrolled up is left where they are.
  const atBottomRef = useRef(true);
  atBottomRef.current = atBottom;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [showOrig, setShowOrig] = useState<Set<string>>(new Set());
  // Which lines arrived live (so they animate). History that loads in one batch does not.
  const known = useRef<Set<string>>(new Set());
  const live = useRef<Set<string>>(new Set());
  const loaded = useRef(false);
  const batch = !loaded.current && lines.length > 1;
  for (const l of lines) {
    if (!known.current.has(l.id)) {
      known.current.add(l.id);
      if (!batch) live.current.add(l.id);
    }
  }
  useEffect(() => {
    if (lines.length > 0) loaded.current = true;
  }, [lines.length]);
  useEffect(() => {
    if (atBottom) ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [lines.length, interim, atBottom, micOn]);
  const words = (s: string) => s.split(" ").map((w, k) => <Fragment key={k}><span className="tl-w" style={{ "--w": k } as React.CSSProperties}>{w}</span>{" "}</Fragment>);
  const initial = (name?: string) => (name ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={ref} onScroll={(e) => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60); }}
        className={`flex h-full flex-col overflow-y-auto px-4 pt-8 sm:px-6 lg:px-12 ${atBottom ? "pb-4" : "pb-[72px]"}`}
        style={{ WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 40px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 40px)" }}>
        {lines.length === 0 && <p className="mt-16 text-center text-base text-muted-foreground sm:m-auto sm:max-w-sm sm:text-balance">No captions yet. Turn on your microphone, or wait for someone to speak.</p>}
        <ul className={`flex flex-col ${lines.length ? "mt-auto" : ""}`}>
          {lines.map((l, idx) => {
            const sp = byId.get(l.speaker_id ?? "");
            const tr = textFor(l);
            const orig = showOrig.has(l.id) || !tr;
            const pending = !tr && l.language !== me.language;
            const isLive = live.current.has(l.id);
            const age = Math.min(lines.length - 1 - idx + (interim ? 1 : 0), 6);
            const bodyText = orig ? l.text : tr!;
            const text = (
              <>
                <p lang={orig ? l.language : me.language} className={`tl-big break-words ${pending ? "text-muted-foreground" : ""}`} style={{ fontWeight: 500 + Math.round(l.loudness * 2) * 50 }}>
                  {isLive ? words(bodyText) : bodyText}
                </p>
                {tr && !showOrig.has(l.id) && <p lang={l.language} className="tl-small break-words">{l.text}</p>}
                {pending && <p className="mt-1 text-sm text-muted-foreground">translating…</p>}
                {tr && showOrig.has(l.id) && <p className="mt-1 text-sm text-muted-foreground">original · tap for translation</p>}
              </>
            );
            return (
              <li key={l.id} data-age={age} className={`tline ${isLive ? "tline-new" : ""}`} style={{ "--speaker": sp?.color } as React.CSSProperties}>
                {l.ambiguous && (
                  <button onClick={() => onFix(l)} className="mb-2 flex min-h-11 items-center gap-1.5 rounded-xl border-2 border-primary px-3 text-sm font-semibold">
                    <HelpCircle className="size-4" aria-hidden /> Not sure who said this · tap to fix
                  </button>
                )}
                <div className="tl-in">
                  <div className="tl-who">
                    <button onClick={() => onFix(l)} aria-label={`Change speaker: ${sp?.name ?? "Unknown speaker"}`}
                      className="tl-chip relative z-10 min-w-11 text-left after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']">
                      <span className="tl-disc" aria-hidden>{initial(sp?.name)}</span>
                      {sp?.name ?? "Unknown speaker"}{l.ambiguous ? "?" : ""}
                    </button>
                    {sp && <span className="tl-lang">{sp.role === "talk" ? "Local" : sp.role === "follow" ? "Tourist" : "Local · Tourist"} · {sp.language.toUpperCase()}</span>}
                    <span className="text-muted-foreground">{fmtTime(l.created_at)}</span>
                  </div>
                  {tr ? (
                    <button className="block w-full text-left"
                      onClick={() => setShowOrig((s) => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}>
                      {text}
                    </button>
                  ) : (
                    <div>{text}</div>
                  )}
                </div>
              </li>
            );
          })}
          {interim && (
            <li data-age={0} className="tline" style={{ "--speaker": me.color } as React.CSSProperties}>
              <div className="tl-in">
                <div className="tl-who">
                  <span className="tl-chip"><span className="tl-disc" aria-hidden>{initial(me.name)}</span>{me.name}</span>
                  <span className="text-muted-foreground">now</span>
                </div>
                <p lang={me.language} className="tl-big text-muted-foreground">{interim}</p>
              </div>
            </li>
          )}
        </ul>
        {micOn && (
          <div className="mt-5">
            <span role="status" className="tl-listening">
              <span className="tl-eq" aria-hidden><i /><i /><i /><i /></span>
              Listening to you
            </span>
          </div>
        )}
      </div>
      {!atBottom && (
        <button onClick={() => { setAtBottom(true); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }}
          className="absolute inset-x-4 bottom-2 sm:inset-x-6 lg:inset-x-12 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brown px-4 text-base font-bold text-cream">
          Jump to live <ArrowDown className="size-4" aria-hidden />
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
      <Button variant="outline" onClick={() => input.current?.click()}><ImagePlus aria-hidden /> Share a photo</Button>
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} aria-label="Choose a photo" />
    </>
  );
}

