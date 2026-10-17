# Gamige — project context for Claude Code

Gamige (Georgian for "understand me") is a 24h hackathon project (Track 02: Multiplayer agentic experiences).
Mission: end the loneliness of sitting at a table but outside the conversation — someone who doesn't speak the
language, is hard of hearing, or sits at the far end of a long supra table.

Every person at the table joins a room from their phone. **Every person has a personal AI agent.** The agents talk
to each other and build things together (a shared notebook, picture references, memes, a recap), so the person
who is left out gets the conversation back.

Judging for our track: "Each agent knows what the other agent changed. No conflicts, always up to date, like Figma.
Smooth to use. A live demo with two people on stage." Everything we build should make that visible.

Pitch line: *Microsoft built a transcript. We built a seat at the table.* (Captions alone already exist —
Microsoft Group Transcribe. Our difference is the agents and the belonging layer.)

## Team and ownership (two people, working in parallel on `main`)

- **Front (Person A)** works in Lovable: screens, components, styles, presenter view, demo seed. Lovable pushes to `main`.
- **Back (Person B, this Claude Code session)** owns ONLY:
  - `src/routes/api/agent.ts` — the single server route, one `task` per AI job
  - `src/lib/agent.ts` — client functions the UI calls
  - `src/lib/ai.server.ts` — AI helper (Lovable AI Gateway)
  - anything new under `src/server/` — put new logic here, called from `agent.ts`
- **Do not edit UI components, pages, or styles.** If a feature needs UI, write down exactly what the front needs
  (table, columns, what to render) and tell the user to send it to Lovable.
- **The database is the contract.** Never rename, drop, or change the type of existing tables/columns.
  New tables/columns: ask the user first; the front adds them through Lovable so Lovable Cloud stays in sync.
- Keep these UI-facing function names and arguments stable: `startMic`, `stopMic`, `requestCatchUp`,
  `describePhoto`, `generateRecap`, `playWhisper`.

## Git workflow

- Everyone works on `main` (Lovable only syncs `main`, and the preview shows `main`).
- Loop: `git pull` → change → small commit → `git pull` → `git push`. Push every 30–60 min.
- AI keys live on Lovable's servers, not in the repo, so AI features can't run locally. Test on the Lovable
  preview link after pushing (≈1 min).
- If a push breaks the app: `git revert HEAD && git push`, then fix calmly.
- Never commit secrets.

## Stack (what exists today)

- TanStack Start app built by Lovable, Supabase (Lovable Cloud) with realtime on all tables, storage bucket `photos`.
- AI: Lovable AI Gateway via the `aiStream()` helper in `src/lib/ai.server.ts`, on several gateway models picked
  per call (`opts.model`). All model names live in the `MODELS` object at the top of `ai.server.ts` — swap there.
  Reasoning is off on every call (OpenAI `reasoning_effort: "none"`, Google `thinking_budget: 0`, Anthropic no
  `thinking`). Current models:
  - trigger check (agent loop): `openai/gpt-6-luna`
  - translate: `google/gemini-3.1-flash-lite`
  - agent answers, catch-up, photo describe: `google/gemini-3.8-flash`
  - recap and the tamada toast: `anthropic/claude-sonnet-5`
  - fallback default: `openai/gpt-6-astra`
  Anthropic models go through the gateway too — we are NOT calling the Anthropic API directly (cost).
- Speech-to-text: English/Russian speakers use the browser Web Speech API; Georgian speakers record short
  voice-activity chunks with MediaRecorder and send them to `google/gemini-3.5-transcribe` (task `transcribe`).
- Crosstalk handling: language filter, per-member `voice_level` calibration, loudest-phone-wins, hold-to-talk mode.
- Whisper: `playWhisper()` uses `window.speechSynthesis` (listener hears English/Russian, which iPhone voices support).

### Tables

`rooms`, `members` (name, language ka|en|ru, role talk|follow|both, `facts`, `whisper_on`, color, approved,
`voice_level`), `lines`, `translations`, `agent_messages` (from_member_id, to_member_id nullable,
type ask|answer|note|missed|bridge, content), `notebook` (kind person|glossary|decision|moment, title, body,
owner_member_id), `photos`, `photo_captions`, `cards` (member_id, kind context|catchup|recap), `invites`.

## Credits budget (important)

AI calls in the app spend Lovable credits from the same balance we use to build. If it hits zero, AI stops
and the backend can pause — fatal during the demo. So:
- Never call AI on silence or on every line by default. Use a cheap trigger check first, then the bigger call.
- Rate limits: max one agent exchange per room every 15 s; max one picture reference per 20 s; max one meme per minute.
- Cache results (a notebook entry or image found once is reused by every agent).
- Prefer the smallest model that does the job; use bigger models only for recap and agent answers.

## How the agents behave

Each member has one agent. An agent knows:
- its human's profile: name, language, role, `facts` (3 facts they typed when joining)
- what its human has seen and understood so far (their lines, translations, cards)
- the shared notebook and the recent conversation

### Personality and rules
- **Quiet by default.** Agents act on triggers, never comment on every line. Silence is better than noise.
- **Short.** Agent messages ≤ 25 words. Cards ≤ 2 sentences. Always in the recipient's language.
- **Helpful, warm, a bit witty** — like a friend sitting next to you whispering context. Never condescending.
- **Never invent facts about people.** An agent may only state facts its own human typed in `facts` or said out
  loud. If it doesn't know, it says so in `agent_messages` ("Not sure — Nika didn't mention").
- **Privacy:** an agent shares its human's facts only when it directly answers a question at the table. Never
  shares anything about health, money, or relationships unless the human said it out loud.
- **Reuse before creating.** Before writing a notebook entry, image, or meme, check whether another agent already
  made one for the same thing; if so, reference it (that's the "each agent knows what the other changed" proof).
- **One owner per entry.** The agent that creates a notebook entry owns it; others may append a short note via
  `agent_messages` type `note` instead of editing it. No conflicts.

### Triggers (cheap check on the latest line + last ~5 lines)
Return one of: `none`, `unknown_name`, `reference` (culture, song, film, meme, place, event), `joke`, `decision`,
`visual` (a place, food, object, person, or thing that would be clearer as a picture), `missed` (the listener
looks lost: e.g., they asked "what?" or haven't spoken for a while).

### The exchange (Track 2 core)
1. Listener's agent (member whose language ≠ speaker's) writes `ask` to the speaker's agent.
2. Speaker's agent answers from its human's `facts` + recent lines → `answer`.
3. The answer becomes ONE `notebook` entry (owner = speaker's member).
4. A private `context` card goes to each listener who needs it, in their language.

## Features (back end), in priority order

1. **Agent loop** (task `agent`) — triggers + ask/answer + notebook + cards, as above. Highest priority.
2. **Picture references** — when the trigger is `visual` or `reference` about a real place/thing (e.g. someone
   says "Budapest", "khachapuri", "Narikala"), find a real image and show it to the listeners with a one-line
   caption in their language, and add it to the notebook entry.
   - Source 1 (free, no key): Wikipedia REST summary `https://en.wikipedia.org/api/rest_v1/page/summary/<Title>`
     → `thumbnail.source` / `originalimage.source`. Ask the model for the best English Wikipedia title first.
   - Source 2 (optional, free key): Pexels or Unsplash search, for generic things ("Georgian supra table").
   - Always store the image URL + credit/source. Never show images of private people.
   - Needs a place to store it: propose a `media` table (room_id, line_id, notebook_id, kind
     `reference_image`|`meme`, query, url, caption_by_language jsonb, credit, created_by_member_id) and ask the
     user to have Lovable add it + render it in cards, notebook and the presenter view.
3. **Joke translator memes** — on trigger `joke`, the speaker's agent explains what's funny, the listener's agent
   remakes it as a meme that lands in the listener's culture. Use a known meme template (e.g. Imgflip
   `get_memes` list, no auth) + agent-written top/bottom text; the front renders text on the template.
   Stored in `media` with kind `meme`. Max one per minute. Keep it kind; never mock anyone at the table.
4. **Photos** (`describePhoto`) — caption + description in every room language; the sharer's agent adds context
   from its human's facts ("Nika's dog, Batumi last summer"), but only what the human typed or said.
5. **Catch me up** (`requestCatchUp`) — last ~2 min → 2 sentences in the listener's language.
6. **Recap / memory card** (`generateRecap`) — group photo + member names + best moments + decisions +
   pictures/memes from the night, written per language. This is the last thing judges see: make it warm and specific.
7. **Stretch: AI Tamada toast** — at the end, the agents co-write a short Georgian-style toast about the people at
   the table, each agent contributing one line from its human's facts, merged into one toast per language.

## Demo the build must support

Two people on stage: a Georgian speaker and an English speaker (whisper on, AirPods in). Presenter view
`/t/:code/screen` on a laptop shows captions, the agents talking, notebook, pictures and memes.
Flow: join by QR → talk → a name/reference comes up → agents ask/answer on screen → notebook + picture appear →
a joke becomes a meme → share a photo → catch me up → end the night → memory card.
A **Replay demo** button re-inserts a scripted scene as a fallback if live audio fails. Keep it working.

## Definition of done for any back-end change

- Works on the Lovable preview on a real iPhone (Safari), not just in theory.
- Respects rate limits and doesn't burn credits on silence.
- No edits outside the back-end files listed above.
- Tell the user in one short paragraph: what changed, how to test it, and anything the front needs from Lovable.
- **Health check first.** After every back-end push, tell the user to open the preview and run the health check
  before testing anything else: open `<preview-url>/api/agent?task=health` (or POST `{ "task": "health" }`). It makes
  one tiny real call per model (trigger, translate, agent, recap) and returns `ok` plus model name, time and error for
  each. Everything should say `"ok": true`; if not, fix that before any feature testing. Costs 4 tiny calls — once
  per push, not in a loop.
