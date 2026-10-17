import { useState } from "react";
import { Mic } from "lucide-react";
import { LANGS, ROLES, type Lang, type Role } from "@/lib/room";
import { calibrateVoice } from "@/lib/agent";

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
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/20">
        <Mic className="h-9 w-9 text-primary" />
      </div>
      <h1 className="text-3xl font-bold">One quick thing</h1>
      <p className="text-lg text-muted-foreground">
        Put your phone where it will sit during dinner and say:<br />
        <span className="font-semibold text-foreground">"Hi, I'm {name}"</span>
      </p>
      <p className="text-sm text-muted-foreground">This helps your phone ignore other voices around the table.</p>
      {error && <p className="rounded-2xl bg-destructive/20 p-3 text-sm text-destructive-foreground">{error}</p>}
      <button onClick={run} disabled={busy}
        className="w-full rounded-full bg-primary py-5 text-xl font-semibold text-primary-foreground disabled:opacity-50">
        {busy ? "Listening…" : "Calibrate my voice"}
      </button>
      <button onClick={() => onDone(null)} className="text-muted-foreground underline">Skip for now</button>
    </div>
  );
}

export function JoinForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
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
        <span className="text-sm text-muted-foreground">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          required
          className="rounded-2xl border bg-card px-4 py-4 text-xl outline-none focus:ring-2 focus:ring-ring"
          placeholder="Ani"
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">I understand</span>
        <div className="grid grid-cols-3 gap-2">
          {LANGS.map((l) => (
            <button
              type="button"
              key={l.id}
              onClick={() => setLanguage(l.id)}
              className={`rounded-2xl border px-2 py-4 text-center transition ${language === l.id ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}
            >
              <div className="text-lg font-semibold">{l.native}</div>
              <div className="text-xs opacity-75">{l.label}</div>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Tonight</span>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => setRole(r.id)}
              className={`rounded-2xl border px-2 py-4 text-base font-medium transition ${role === r.id ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">3 quick facts about you (for your agent)</span>
        <textarea
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
          rows={3}
          maxLength={300}
          className="rounded-2xl border bg-card px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-ring"
          placeholder={"From Berlin\nVegetarian\nFirst time in Georgia"}
        />
      </label>
      <button
        disabled={busy || !name.trim()}
        className="rounded-full bg-primary py-5 text-xl font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Joining…" : submitLabel}
      </button>
    </form>
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]">{children}</main>;
}
