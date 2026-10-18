import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Screen } from "@/components/JoinForm";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Join a table — Gamige" },
      { name: "description", content: "Enter the 4-letter table code to join a Gamige table." },
      { property: "og:title", content: "Join a table — Gamige" },
      { property: "og:description", content: "Enter the 4-letter code to join." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinCode,
});

function JoinCode() {
  const [code, setCode] = useState("");
  const nav = useNavigate();
  return (
    <Screen>
      <Link
        to="/"
        className="-ml-2 inline-flex min-h-11 items-center gap-2 self-start px-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Link>
      <h1 className="mt-6 text-4xl font-semibold">Join a table</h1>
      <p className="mt-2 font-display text-lg leading-snug text-muted-foreground">
        Ask the host for the 4-letter code, or scan their QR.
      </p>
      <form
        className="mt-10 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 4) nav({ to: "/t/$code", params: { code } });
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
          autoFocus
          inputMode="text"
          autoCapitalize="characters"
          placeholder="ABCD"
          aria-label="Table code"
          className="min-h-24 w-full rounded-lg border border-input bg-background py-4 pl-[0.3em] text-center font-display text-6xl uppercase tracking-[0.3em] transition-colors placeholder:text-input focus-visible:border-ring"
        />
        <Button size="lg" disabled={code.length !== 4}>
          Continue
        </Button>
      </form>
    </Screen>
  );
}
