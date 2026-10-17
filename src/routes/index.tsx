import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { createRoom, seedDemo } from "@/lib/room";
import { Screen } from "@/components/JoinForm";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gamige — understand me at the dinner table" },
      { name: "description", content: "Join a shared table from your phone. Personal agents help everyone follow the conversation in Georgian, English or Russian." },
      { property: "og:title", content: "Gamige — understand me" },
      { property: "og:description", content: "Follow the dinner-table conversation in your own language." },
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
    <Screen>
      <div className="flex flex-1 flex-col justify-center gap-3 py-10">
        <p className="text-sm uppercase tracking-[0.3em] text-primary">გამიგე</p>
        <h1 className="text-6xl font-bold leading-none">Gamige</h1>
        <p className="mt-2 text-xl text-muted-foreground">"Understand me." Everyone at the table, in their own language.</p>
      </div>
      <div className="flex flex-col gap-3">
        <button
          onClick={run("start", async () => {
            const r = await createRoom();
            nav({ to: "/t/$code", params: { code: r.code } });
          })}
          disabled={!!busy}
          className="rounded-3xl bg-primary py-7 text-2xl font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy === "start" ? "Setting the table…" : "Start a table"}
        </button>
        <Link to="/join" className="rounded-3xl border bg-card py-7 text-center text-2xl font-semibold">
          Join a table
        </Link>
        <button
          onClick={run("demo", async () => {
            const r = await seedDemo();
            nav({ to: "/room/$code", params: { code: r.code } });
          })}
          disabled={!!busy}
          className="py-4 text-base text-muted-foreground underline-offset-4 hover:underline"
        >
          {busy === "demo" ? "Preparing demo…" : "Try a demo room"}
        </button>
      </div>
    </Screen>
  );
}
