import { toast } from "sonner";
import { X } from "lucide-react";
import type { Line, Member } from "@/lib/room";
import { reassignLine, undoCorrection } from "@/lib/speakers";

/** Reassigns a line and offers Undo right in the toast. */
export async function applyReassign(line: Line, speaker: Member, me: Member | undefined) {
  try {
    const id = await reassignLine(line.id, speaker.id, me?.id ?? null);
    toast.success(`Moved to ${speaker.name}`, {
      description: "Nearby unsure lines from the same voice moved too.",
      action: { label: "Undo", onClick: () => void undoCorrection(id).then(() => toast("Correction undone")).catch(() => toast.error("Couldn't undo")) },
    });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Couldn't move this line");
  }
}

/** Bottom sheet: "Who said this?" with one big button per person at the table. */
export function ReassignSheet({ line, members, me, onClose }: { line: Line; members: Member[]; me: Member | undefined; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-background/70 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-label="Who said this?" className="w-full rounded-t-3xl border-t bg-card p-5 pb-8 text-base" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Who said this?</h2>
          <button onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 rounded-2xl bg-secondary p-3 text-lg">"{line.text}"</p>
        <div className="flex flex-col gap-2">
          {members.filter((m) => m.approved).map((m) => (
            <button key={m.id}
              onClick={() => { onClose(); if (m.id !== line.speaker_id || line.ambiguous) void applyReassign(line, m, me); }}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-lg ${m.id === line.speaker_id ? "border-primary" : ""}`}>
              <span className="h-4 w-4 rounded-full" style={{ background: m.color }} />
              <span className="flex-1">{m.name}</span>
              {m.id === line.speaker_id && <span className="text-sm text-muted-foreground">{line.ambiguous ? "current guess" : "current"}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
