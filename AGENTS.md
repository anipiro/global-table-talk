# Gamige — technical rules
- Guests have no accounts; identity is a member id kept in localStorage per room code, and tables use open guest RLS policies — why: join-by-name was a product requirement.
- All AI work goes through the single server route `src/routes/api/agent.ts` (task-based), with model helpers in `src/lib/ai.server.ts` — why: keeps the gateway key server-side and one place to change prompts.
- Client-side agent entry points live in `src/lib/agent.ts`; speech capture and whisper use the browser's built-in speech APIs — why: no extra providers needed.
- Room data loads and subscribes via `useRoom` in `src/lib/useRoom.ts`; screens never open their own realtime channels for room tables — why: one channel per room avoids leaks.
- The photos bucket is private; display via signed URLs — why: workspace blocks public buckets.
