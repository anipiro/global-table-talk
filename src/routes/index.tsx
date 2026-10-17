import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { createRoom, seedDemo } from "@/lib/room";
import { Button, buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gamige: every voice, in your language" },
      { name: "description", content: "Gamige tells who is speaking and shows live captions and translation as they talk. Built for trips, meetups and any group that doesn't share a language." },
      { property: "og:title", content: "Gamige: every voice, in your language" },
      { property: "og:description", content: "Live captions and translation that show who is speaking, for groups that don't share a language." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (k: string, fn: () => Promise<void>) => async () => {
    setBusy(k);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="screen-in relative mx-auto w-full max-w-[1180px] px-6 pb-[max(env(safe-area-inset-bottom),3rem)] pt-[max(env(safe-area-inset-top),1.5rem)] min-[900px]:px-14">
      <div className="home-grid grid min-h-[calc(100dvh-4.5rem)] content-center">
        <div className="hg-head">
          <h1 className="home-title rise" style={{ "--i": 1 } as React.CSSProperties}>
            Gamig<em>e</em>
          </h1>
        </div>
        <div className="home-art hg-art rise" style={{ "--i": 3 } as React.CSSProperties} aria-hidden="true">
          <i className="s1" />
          <i className="s2" />
          <i className="s3" />
          <i className="s4" />
          <i className="s5" />
          <div className="discs">
            {[
              ["var(--terracotta)", "var(--cream)", "Y"],
              ["var(--spk-blue)", "var(--foreground)", "N"],
              ["var(--spk-sage)", "var(--foreground)", "D"],
              ["var(--spk-mauve)", "var(--foreground)", "M"],
            ].map(([bg, fg, ch]) => (
              <span
                key={ch}
                className="-ml-2.5 grid size-[clamp(46px,12vw,70px)] place-items-center rounded-full text-[clamp(20px,5vw,31px)] font-extrabold leading-none ring-4 ring-aubergine first:ml-0"
                style={{ background: bg, color: fg }}
              >
                {ch}
              </span>
            ))}
          </div>
        </div>
        <div className="hg-rest">
          <h2 className="rise mt-5 max-w-[15em] text-balance text-[clamp(30px,7.4vw,48px)] leading-[1.04]" style={{ "--i": 4 } as React.CSSProperties}>
            Every voice, in your language.
          </h2>
          <p className="rise mt-4 max-w-[34rem] text-lg leading-snug text-muted-foreground" style={{ "--i": 5 } as React.CSSProperties}>
            Gamige tells who is speaking and shows live captions and translation as they talk. Built for trips, meetups and any group that doesn't share a language.
          </p>
          <div className="rise mt-7 flex max-w-sm flex-col gap-3" style={{ "--i": 6 } as React.CSSProperties}>
            <Button
              size="lg"
              onClick={run("start", async () => {
                const r = await createRoom();
                nav({ to: "/t/$code", params: { code: r.code } });
              })}
              disabled={!!busy}
            >
              {busy === "start" ? "Setting the table…" : "Start a table"}
            </Button>
            <Link to="/join" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Join a table
            </Link>
            <Button
              variant="ghost"
              onClick={run("demo", async () => {
                const r = await seedDemo();
                nav({ to: "/room/$code", params: { code: r.code } });
              })}
              disabled={!!busy}
              className="underline decoration-2 underline-offset-[5px]"
            >
              {busy === "demo" ? "Preparing demo…" : "Try a demo room"}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
