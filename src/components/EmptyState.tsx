import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The empty state of a bottom-sheet tab (Agents, Notebook, Photos). Deliberately quiet: one round brown badge with the
 * tab's own icon inside a thin ring, a serif title and one muted line, left-aligned at the same gutter as the content of
 * the other tabs. On a phone the badge sits above the text; from 640px up it sits beside it; on a short phone (760px tall or less,
 * where the sheet is under 200px) it is hidden so the text always fits. The block centres vertically
 * in the sheet with auto margins, so if it is ever taller than the sheet it scrolls from the top instead of being clipped.
 * It sizes itself in em, so `large` (the presenter screen) scales the whole thing. The badge is aria-hidden.
 */
export function EmptyState({ icon: Icon, title, children, large = false }: { icon: LucideIcon; title: string; children: ReactNode; large?: boolean }) {
  return (
    <div className={large ? "flex min-h-full text-2xl" : "flex min-h-full text-base"}>
      <div className="my-auto flex w-full max-w-[42em] flex-col items-start gap-4 py-2 sm:flex-row sm:items-center sm:gap-6">
        <span aria-hidden="true" className="empty-badge shrink-0 rounded-full border-2 border-brown/25 p-[0.35em]">
          <span className="grid size-[3.5em] place-items-center rounded-full bg-brown text-cream">
            <Icon className="size-[1.5em]" strokeWidth={1.75} />
          </span>
        </span>
        <div>
          <p className={large ? "font-display text-6xl leading-none" : "font-display text-[2.1rem] leading-none"}>{title}</p>
          <p className="mt-2 max-w-[30em] text-balance text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  );
}
