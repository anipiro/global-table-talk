Editorial redesign of the whole UI, new Home pitch, smoother room and bottom sheet.

Scope: frontend visuals and copy only. No change to logic, routes, Supabase, agent code, tests, package.json or bun.lock. The only file in src/lib that changed is invites.ts, for one error message string.

Tokens and palette (src/styles.css)
- One light theme replaces the dark one: tan-oat ground with a faint static paper grain, beige cards, ink text, warm dark brown as the primary colour for buttons and bars.
- Terracotta is the live mic, red-brown is the italic "e" of the title, apricot marks badges, aubergine is the private card and the Home artwork, soft apricot is the bottom sheet, caramel is the active tab.
- All colours are oklch. New tokens: brown, cream, cream-2, aubergine, terracotta, redbrown, apricot, sheet, placeholder, pick-hover, primary-hover, tab-active, code-1 to code-4, scroll-thumb, scroll-thumb-hover, spk-blue, spk-sage, spk-mauve, tint-1 to tint-3, ease-out, spring.
- Radii are explicit (8 to 32px). Surfaces are flat: no shadows, blur or gradients. Three soft shapes drift behind every page.
- Speaker colours stay data. As text they go through .speaker-ink (at least 5.4:1), never as a raw colour.
- Motion is transform and opacity only and stops under prefers-reduced-motion.
- Shared parts restyled: button, input, textarea, toast, switch, dropdown menu.

Fonts (public/fonts, all SIL OFL 1.1, licence texts included)
- Instrument Serif regular and italic (title and headings), Onest variable (Latin and Cyrillic), Noto Sans Georgian variable (Georgian).
- Self-hosted woff2 with unicode-range, two preloads, Google Fonts links removed.

Georgian
- Georgian text is routed to Noto Sans Georgian (size-adjust 97%) with line-height 1.55 for :lang(ka). Mtavruli capitals were tried and dropped.

Home copy
- Headline "Every voice, in your language." with a subline about speaker names, live captions and translation for trips, meetups and mixed-language groups.
- The small Georgian word and the "Georgian for understand me" line are gone. Title "Gamige" with a red-brown italic "e". Button texts are unchanged.

Metadata and copy sweep
- Page titles, descriptions and og/twitter text rewritten for the new pitch on root, Home, join, invite, table link, room and recap.
- "This dinner has ended" is now "This table has ended". The invite error and the calibration hint no longer say dinner.
- Left alone on purpose: AI prompts (src/server, routes/api), README, demo conversation data.

Join form (JoinForm.tsx, t.$code.tsx)
- Label reads "3 quick facts about you (optional)". Third placeholder is "First time in Lisbon". Name placeholder is "Alex" (was "Ani").
- Name input and facts box share one look: beige fill, brown text, 2px brown border, lighter placeholder (4.6:1).
- Host button "Open the table" is the same dark brown as the selected pickers in every state, through a styling-only keepBrown prop. Guest "Join" is unchanged.
- Empty name: the button is disabled, so a hint now says "Enter your name to continue." (linked with aria-describedby, space reserved so nothing shifts). No routing or redirect code changed.
- Pickers keep aria-pressed. Hover is a tan fill with a full brown border, selected is brown with cream text (the small language label stays readable), 2px border in every state, 150ms colour transition, press scale only when motion is allowed, cursor pointer.

Lobby and host controls
- The QR is the focal point, the table code is four brown tiles, guest and invite rows are tonal cards with name chips.

Room
- Fills the whole page at every width with side gutters of 16, 24 and 48px (a centred panel was tried and replaced). Private cards sit in the page flow.
- Live captions: large translation line, small original, speaker thread and name chip, word by word reveal for new lines. Mic is terracotta when live.
- Bottom tab bar is warm brown with one caramel pill that slides under the active tab. Switching tabs fades the old panel out and the new one in, with constant padding so the width no longer jumps.
- The sheet eases open and closed and the chevron turns. The newest caption stays in view while it resizes.
- Empty states for Agents, Notebook and Photos use a new EmptyState component (brown icon badge, serif title, one line). The badge is hidden on short phones so the text always fits.
- More menu: every item has an icon (Hold to talk and Mic debug overlay added), and the check mark sits in a reserved slot on the right.

Scrollbars
- Slim rounded brown thumb, transparent track, no arrow buttons, with a standard-property fallback for Firefox.

Other screens
- History, overlap, recap, presenter, 404 and the dev pages inherit the tokens, with pill shapes, shadows and raw speaker-colour text replaced.

New files
- public/fonts/ (8 files), src/components/EmptyState.tsx, CHANGES-ui-redesign.md. .gitignore gained entries for .env, public/mockups, screenshots and uploads.

Checks run
- npx tsc --noEmit: passes. npx vitest run: 6 files, 70 tests pass. npm run build: passes.
- Not run: the Python e2e tests (Python is not installed here). Every pinned label and role was kept.
- Console check on 11 real pages: clean, except a React warning on the presenter. It comes from an original line in t.$code_.screen.tsx that returns the result of scrollIntoView, which newer Chromium returns as a Promise. It is unrelated to this work and harmless, and was left unchanged.
