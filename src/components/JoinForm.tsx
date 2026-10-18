import { useState } from "react";
import { Mic } from "lucide-react";
import { LANGS, ROLES, type Lang, type Role } from "@/lib/room";
import { calibrateVoice } from "@/lib/agent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Shared look of the language and role pickers. The border is 2px in every state so nothing shifts.
 * Only background and border colour transition (150ms); the press scale is transform-only and is
 * left out entirely under reduced motion (motion-safe). Tailwind v4 applies hover: only where the
 * device can hover, so touch screens do not get a stuck hover state.
 */
const choiceClass =
  "flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-md border-2 px-2 py-2 text-center transition-[background-color,border-color] duration-150 motion-reduce:transition-none motion-safe:active:scale-[0.98]";
/** Unselected: cream card; hover moves to a clearly darker tan and the full brown border. */
const choiceOff = "border-input bg-card text-foreground hover:border-primary hover:bg-pick-hover";
/** Selected: brown fill with cream text; hover lifts it a little. The secondary label is cream-2 (see below). */
const choiceOn = "border-primary bg-primary text-primary-foreground hover:bg-primary-hover";
/**
 * The two text fields (name and facts) share one look: a beige fill (--card, not white), brown text and a 2px
 * full-brown border. The placeholder is the lighter --placeholder tone, a step down from the typed text. Focus
 * uses the app-wide brown outline with its offset, the same as every other field.
 */
const fieldClass = "border-primary bg-card text-foreground placeholder:text-placeholder";
/**
 * The host's "Open the table" button: exactly the same dark brown (--primary) as the selected pickers, in every
 * state including empty (disabled), so the two never differ. Hover lifts both to --primary-hover. Disabled is
 * shown by the not-allowed cursor and a slightly softer cream-2 label (10.3:1), not by a different brown.
 * Only the host's button uses this; the guest's Join keeps the default look.
 */
const brownButton = "disabled:bg-primary disabled:text-cream-2";

/** After joining: ask the member to say a short sentence so we can measure their voice level
 *  (used to filter out a neighbour's voice picked up by this phone). */
export function VoiceCalibration({ name, onDone }: { name: string; onDone: (voiceLevel: number | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      const level = await calibrateVoice();
      onDone(level);
    } catch {
      setError("Couldn't reach the microphone. You can skip this and calibrate later from the room.");
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-secondary">
        <Mic className="size-9 text-primary" aria-hidden />
      </div>
      <h1 className="text-3xl font-semibold">One quick thing</h1>
      <p className="font-display text-lg leading-snug text-muted-foreground">
        Put your phone where it will sit during the conversation and say:<br />
        <span className="font-semibold text-foreground">“Hi, I’m {name}”</span>
      </p>
      <p className="text-sm text-muted-foreground">This helps your phone ignore other voices around the table.</p>
      {error && (
        <p role="alert" className="w-full rounded-md border border-destructive p-3 text-left text-sm text-destructive">
          {error}
        </p>
      )}
      <Button size="lg" onClick={run} disabled={busy} className="w-full">
        {busy ? "Listening…" : "Calibrate my voice"}
      </Button>
      <Button variant="ghost" onClick={() => onDone(null)} className="text-muted-foreground">
        Skip for now
      </Button>
    </div>
  );
}

export function JoinForm({
  submitLabel,
  keepBrown = false,
  onSubmit,
}: {
  submitLabel: string;
  /** Presentation only: keep the submit button a brown box even when disabled (the host's "Open the table"). */
  keepBrown?: boolean;
  onSubmit: (v: { name: string; language: Lang; role: Role; facts: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Lang>("en");
  const [role, setRole] = useState<Role>("both");
  const [facts, setFacts] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await onSubmit({ name: name.trim(), language, role, facts: facts.trim() });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Your name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          required
          className={`min-h-12 text-lg ${fieldClass}`}
          placeholder="Alex"
        />
      </label>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">I understand</legend>
        <div className="grid grid-cols-3 gap-2">
          {LANGS.map((l) => (
            <button
              type="button"
              key={l.id}
              aria-pressed={language === l.id}
              onClick={() => setLanguage(l.id)}
              className={`${choiceClass} ${language === l.id ? choiceOn : choiceOff}`}
            >
              <span lang={l.id} className="text-lg font-semibold">{l.native}</span>
              <span className={`text-xs ${language === l.id ? "text-cream-2" : "text-muted-foreground"}`}>{l.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">Tonight</legend>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <button
              type="button"
              key={r.id}
              aria-pressed={role === r.id}
              onClick={() => setRole(r.id)}
              className={`${choiceClass} text-base font-medium ${role === r.id ? choiceOn : choiceOff}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          3 quick facts about you <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <Textarea
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
          rows={3}
          maxLength={300}
          className={`text-lg ${fieldClass}`}
          placeholder={"From Berlin\nVegetarian\nFirst time in Lisbon"}
        />
        <span className="text-xs text-muted-foreground">Your agent may use these to find things you have in common with others. Only the overlap is shared.</span>
      </label>
      <Button
        size="lg"
        disabled={busy || !name.trim()}
        aria-describedby={name.trim() ? undefined : "name-hint"}
        className={keepBrown ? brownButton : undefined}
      >
        {busy ? "Joining…" : submitLabel}
      </Button>
      {/* The button is disabled until a name is typed. Because the host's button keeps the same brown either way, say why a
          click does nothing. The line is always reserved (min-h-5) so typing a name does not move the layout. */}
      <p id="name-hint" className="-mt-3 min-h-5 text-center text-sm text-muted-foreground">
        {name.trim() ? "" : "Enter your name to continue."}
      </p>
    </form>
  );
}

export function Screen({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <main className={`screen-in mx-auto flex min-h-dvh w-full ${wide ? "max-w-md md:max-w-5xl" : "max-w-md"} flex-col px-5 pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]`}>{children}</main>;
}
