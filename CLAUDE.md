# Siwi: working notes for Claude

Siwi is our entry to the Meta Global AI Developer Hackathon (Cerebral Valley), Indie Developer track, problem statement **Build for Your World**. Solo entrant: Ahmed (GitHub `aiiitsh`).

**Deadline:** submission closes Wed Nov 4 2026, 9:00 PM ET. Our target is 5:00 PM ET. Feature freeze is Wed 1:00 PM ET.

## What it is
Type one sentence, and a crew of AI agents running on Meta's models builds a playable browser platformer for a few cents. The players who chip in co-own it. For a sequel, players discuss it in the game's thread. Siwi merges the thread into a Season 2 proposal with a cost estimate, players split the cost with simulated pledges, and the same crew **upgrades the existing game** into Season 2.
Demo moments, in priority order: (1) Season 2 funded → upgrade → play, and (2) Tester catches a real bug → coder fixes it.

## Hackathon rules (non-negotiable)
- Must use Meta models (Muse Spark, Wonder, Image, Voice Transcribe, SAM 3.1, open-weight Muse Glimmer and Muse Spark Open, Muse Code).
- Public repo. New work only (build period Oct 27 to Nov 4). Commit small and often. Append a timestamped line to `BUILD_LOG.md` per milestone.
- The demo shows only things built during the hackathon. Never claim a model is used unless it is actually called.
- Games must be gentle and original: no war, guns, politics, or copied games/characters/logos/brands.
- Avoid looking like: medical advice, basic RAG, image analyzer, edu chatbot, job screener, coaches.
- README first lines: what Siwi is, the problem statement, and the Meta models used and for what.

## Judging
Impact 30%, Use of Meta AI tooling 25%, Technical depth 20%, Demo 25%. Bonus targets: Best Agentic, Best Creative (Muse Image), Best Open Weights (Spark Open on Baseten), Most Viral on X.

## Crew
| Agent | Color | Job | Model |
|---|---|---|---|
| Siwi | #FF6FA5 | Orchestrator; tool-calling decisions; budget | Muse Spark |
| Spark | #8B6CFF | Design doc (structured), game.js on our kit, patches | Muse Spark |
| Pixel | #29D8F5 | Hero first, then the rest with the hero as reference | Muse Image |
| Tester | #A8F03A | Sandboxed iframe + harness + vision verdict | Muse Spark (vision) |
| Fixer | — | Only after the same test fails twice | Muse Wonder |
| Open mode | — | Designer + thread summarizer on Spark Open | Muse Spark Open (Baseten) |
Gold #FFC83D money, red #FF5A6E bugs. Background navy #0B1030 to #07091A. Fonts: Inter 800 headlines, mono for logs.

## Architecture rules
- The browser drives the pipeline by calling short server routes step by step. Siwi's route returns a tool call; the browser executes it and reports back. Every step writes an `events` row.
- Hard caps: 3 patch loops, 1 Wonder escalation, about 20 images per game, per-game budget cap shown in the UI.
- The model never writes an engine. It writes `game.js` against our hand-written `public/siwi-kit.js`. Output is one HTML file with the kit, assets (data URIs), game code and harness inlined.
- Every model call goes through `src/lib/callModel.ts` (`callChat`, `callImage`): logs model, tokens, cost, latency, and returns a trace the browser stores as events. Validate every model output with zod.
- **No database** (Ahmed, 2026-11-03: no Supabase spending). Server routes (`/api/agent/[step]`) are stateless; each game lives in the player's browser (IndexedDB, `src/lib/client/db.ts`). Pre-built showcase games ship as static JSON in `public/showcase/`.
- Prompts live in `prompts/` as versioned files. Prices are in `config/pricing.ts`. API facts are in `docs/meta-api-notes.md` (read it before touching an integration; do not guess params).
- Defaults: `reasoning_effort` medium (game.js too: high took 4.6 min live), high for patches, low for Siwi's decisions. Cache every generation in the browser record.
- Keys are server-only. `.env*` is gitignored; never print or commit keys.
- Be honest in the UI: label simulated pledges ("Demo: no real payments") and replays.

## Build order
M1 skeleton + live calls → M2 kit + 2 example games + iframe player → M3 design+code → M4 art → M5 harness/tester/patch loop/Siwi decisions → M6 cost + estimator → M7 Season 2 → M8 crew theater → M9 README/footage.
SHOULD: S1 open mode, S2 Wonder, S3 caching + token counting, S4 gallery. COULD: C1 voice, C2 SAM.
If behind, drop in order: C2, C1, S1, S4, S2, S3. **Never drop M5 or M7.**
Cut entirely: real payments, auth, realtime chat, multiplayer, more than one genre, video generation.

## Working style
Small commits with clear messages. After each milestone, run the flow end to end and report what works and what is fake. Boring, reliable code over clever code. Tell Ahmed early when something won't fit the time.

## Status (update as you go)
- 2026-11-03 04:30 ET: M1 code done (no live call yet: first sandbox had no network to api.meta.ai). M2 done: `public/siwi-kit.js`, `public/siwi-harness.js`, `examples/*.game.js`, `src/lib/playtester.ts` (browser Tester, 7 deterministic checks), `/examples/[slug]` page, `scripts/playtest.mjs` (headless run of any game.js).
- Gotcha: the Tester iframe must stay on-screen and painted (tiny, opacity .02). Offscreen/invisible iframes get rAF throttled and every check fails.
- 2026-11-03 05:00 ET: Live API verified (see docs/meta-api-notes.md log). Supabase dropped. M3-M8 code written: agents (`src/lib/agents.ts`), guardrails (`src/lib/pipeline.ts`), browser runner (`src/lib/client/runner.ts`), crew theater, Season 2 (thread, proposal, token-counted estimate, pledges, upgrade). Work happens on branch `claude/project-thread-uxva81`; Vercel deploys main.
- Gotcha: Meta's API sometimes returns 504 "request timed out"; the SDK retries (maxRetries 3) and the browser retries each step once.
- 2026-11-03 06:50 ET: Full flow verified end to end (S1, S2, bug drill). 3 showcase builds in public/showcase (export with scripts/export-showcase.mjs). PR #1 opened to main; Vercel deploys on merge.
- Gotcha: the visible Tester container must hold only one iframe (replaceChildren), or re-tests render offscreen and get rAF-throttled.
- Gotcha: don't edit src/ while an e2e run is going on the dev server; hot reload restarts the build.
- Vercel: project `siwi` under team siwi3, auto-deploys from main; MODEL_API_KEY set there.
