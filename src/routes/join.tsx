import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Screen } from "@/components/JoinForm";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Join a table — Gamige" },
      { name: "description", content: "Enter the 4-letter table code to join a Gamige dinner." },
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
      <Link to="/" className="text-muted-foreground">← Back</Link>
      <h1 className="mt-8 text-4xl font-bold">Join a table</h1>
      <p className="mt-2 text-lg text-muted-foreground">Ask the host for the 4-letter code, or scan their QR.</p>
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
          className="rounded-3xl border bg-card py-6 text-center font-display text-6xl tracking-[0.3em] outline-none focus:ring-2 focus:ring-ring"
        />
        <button disabled={code.length !== 4} className="rounded-full bg-primary py-5 text-xl font-semibold text-primary-foreground disabled:opacity-40">
          Continue
        </button>
      </form>
    </Screen>
  );
}
