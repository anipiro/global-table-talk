# Global Table Talk

Build "Gamige" (Georgian for "understand me"): a mobile-first web app where people at a dinner table join a shared room from their phones. Each person has a personal AI agent; the agents help people who don't speak the language follow the conversation. This first version is the app shell, database and realtime only. Do NOT implement speech recognition, translation, AI or text-to-speech yet. Leave clearly named stub functions for them.

Use Supabase (auth not needed, guests join by display name only). Enable realtime on every table below.

TABLES
- rooms: id (uuid), code (4 uppercase letters, unique), host_member_id, status ('lobby' | 'live' | 'ended'), created_at
- members: id, room_id, name, language ('ka' | 'en' | 'ru'), role ('talk' | 'follow' | 'both'), facts (text, 3 short facts about me for my agent), whisper_on (bool), color (hex), approved (bool), created_at
- lines: id, room_id, speaker_id, text, language, loudness (float), created_at
- translations: id, line_id, language, text
- agent_messages: id, room_id, from_member_id, to_member_id (nullable), type ('ask' | 'answer' | 'note' | 'missed' | 'bridge'), content, created_at
- notebook: id, room_id, kind ('person' | 'glossary' | 'decision' | 'moment'), title, body, owner_member_id, created_at
- photos: id, room_id, uploader_id, storage_path, created_at
- photo_captions: id, photo_id, language, caption, description
- cards: id, room_id, member_id, kind ('context' | 'catchup' | 'recap'), title, body, created_at
Storage bucket "photos".

SCREENS
1. Home: big "Start a table" and "Join a table" buttons.
2. Join: name, language picker (Georgian / English / Russian), role ("I'll talk" / "Help me follow" / both), a textarea "3 quick facts about you". Join via 4-letter code or a link /t/:code.
3. Host lobby: large QR code for /t/:code, the code in big letters, list of guests with Approve / Remove, and "Start" button.
4. Room (main screen):
   - Caption feed: each line shows the speaker's name in their color, the text in MY language if a translation exists (tap to see original), auto-scroll with a "Jump to live" pill.
   - Top bar: mic button (calls stub startMic()), headphones toggle for whisper_on, "Catch me up" button (calls stub requestCatchUp()), big-text toggle.
   - Bottom sheet tabs: "Notebook" (grouped by kind, live updating), "Agents" (live feed of agent_messages styled like a chat between agents: "Anna's agent → Nika's agent"), "Photos".
   - Private cards for me slide in from the top and can be dismissed.
   - "Share a photo" button: pick from gallery or camera, upload to the photos bucket, insert into photos. Show photos in a grid with their caption in my language.
   - Host only: "End the night" → opens camera for a group photo → shows a Recap screen.
5. Recap: group photo, all member names, and cards of kind 'recap' for me, with a Share button.

STUBS (empty async functions in src/lib/agent.ts, with TODO comments): startMic(), stopMic(), requestCatchUp(), describePhoto(photoId), generateRecap(roomId), playWhisper(text, language).

DESIGN
Warm and calm, like a dinner table at night: dark background, warm off-white text, one accent color, rounded cards, large readable type (captions at least 20px, big-text mode 28px). Mobile first, works one-handed. Keep the screen awake while in a room (Wake Lock API).

Seed: a "Demo room" button on Home that creates a room with 2 fake members and a few sample lines, notebook entries and agent messages so the UI can be tested without audio.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c095d862-a09b-44a9-8f97-ea798e244a06).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
