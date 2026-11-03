# Siwi

**Post a game idea. Players upvote it and add details, pictures and drawings. Siwi prices it from real token counts, everyone who wants it buys in and splits the cost, and a crew of AI agents on Meta's models builds the game live for a few cents. Every new buyer lowers everyone's share, and earlier buyers get the difference back as credits. For a sequel, the thread votes and the same crew upgrades the game into Season 2.**

- **Hackathon:** Meta Global AI Developer Hackathon (Cerebral Valley), Indie Developer track.
- **Problem statement: Build for Your World.** I'm a gamer. I hate paying $50 for a game I play once, then watching the sequel belong to a studio that ignores its players. Siwi lets players make games together, own them, and decide what comes next.
- **The loop:** idea post → players add details and pictures → Spark designs it (picks the genre) → Siwi prices it → players buy in (price ÷ buyers, earlier buyers credited when someone joins) → the crew builds, tests and fixes it → buyers play → Season 2 thread → proposal → price → buy in → upgrade.
- **Meta models used (every one is actually called):**

| Model | Used for |
|---|---|
| **Muse Spark** (`muse-spark-1.3`) | Siwi the producer picks every next step with **tool calling**; Spark reads the idea, players' comments and their uploaded **pictures (vision)** and writes the **structured** design doc (genre, lighting, levels, sprites, credits to the players whose ideas it used), writes `game.js`, patches bugs, merges the sequel thread into a Season 2 proposal; Tester judges playtest **screenshots with vision**. Prompt caching on the shared engine-kit prefix. |
| **Muse Image** (`muse-image-1.0`) | Pixel paints the hero first, **from the players' uploaded drawings when there are any** (`/images/edits`), then every other sprite, floor/wall tiles, background and cover with the hero as the style reference, so the whole game looks like one world. Season 2 art reuses the Season 1 hero. |
| **Muse Wonder** (`muse-wonder-1.0`) | Fixer: called once, only when the same bug survives a Muse Spark patch. |
| **Token counting** (`/v1/responses/input_tokens`) | Grounds every price (Season 1 and Season 2) in the exact size of the real build prompt. |
| **Muse Spark Open** (open weights, Baseten) | Optional: merges the Season 2 thread when `OPEN_API_KEY`/`OPEN_BASE_URL` are set. The UI labels which model merged it. |

Live: _link added at submission_ · Demo video: _link added at submission_

## How it works

```
idea + details + pictures ─► Spark: design doc (structured, vision) ─► Siwi: price (token counting) ─► buyers split it
          │
          ▼
   ┌──► Siwi decides (tool call) ──────────────────────────────────────────┐
   │      generate_art │ write_code │ run_playtest │ patch_code │ escalate_to_wonder │ accept_build
   │                   ▼            ▼              ▼            ▼
   │      Pixel paints  Spark writes  Tester plays    Spark / Fixer
   │      (hero → refs) game.js on    in a sandbox,   patch with
   │                    siwi-kit      checks + vision exact edits
   └─────────────────── every result goes back to Siwi ◄──────────────────┘
```

- **The model never writes an engine.** It writes `game.js` against our hand-written engine kit (`public/siwi-kit.js`), which has two genres: `Siwi.platformer` (side view: physics, gravity flip, stomps) and `Siwi.topdown` (rooms and mazes, keys and doors, lamps as checkpoints, critters that wander or chase, a lantern glow that shoos them). Both support a **darkness + light** mode for spooky games (gentle: ghosts get shooed, nobody gets hurt). Spark picks the genre that fits the idea. Output is one HTML file with the kit, art (data URIs), game code and test harness inlined.
- **The market is simple and visible.** Each season has one price. The first buyer covers all of it; each new buyer pays `price ÷ (buyers + 1)` and every earlier buyer gets the difference back as wallet credits, so the total collected always equals the price. Only buyers can play. A "viewing as" switcher and demo wallets make the money flow visible in the demo.
- **Siwi is a real orchestrator.** Each checkpoint is a Muse Spark tool call. The server enforces guardrails (allowed tools per state, 3 patch loops, 1 Wonder escalation, about 20 images, a per-season budget cap) and falls back to a deterministic rule if the model replies without a tool call (Meta's API supports `tool_choice: "auto"` only).
- **Tester catches real bugs.** Three layers: a static lint that runs `game.js` in a Node VM against a stub kit (syntax, level shape, one player start, a goal, and for top-down games a flood fill proving every key and the exit can be reached), a sandboxed playtest with scripted input in a visible iframe (7 deterministic checks: boots, no errors, not blank, animates, moves, jumps or moves in 2D, interacts), then a Muse Spark vision verdict on the screenshots. Failed checks always fail the build, whatever the model says.
- **Patches are diffs, not rewrites.** Spark returns exact `{find, replace}` edits; if one doesn't match, it gets one retry with the failure explained. The UI shows the diff.
- **Season 2 is an upgrade, not a regeneration.** Players comment in the game's thread; Spark merges it into one proposal crediting who asked for what and listing what was left out; Siwi prices it; players buy in with the same split; then the same crew upgrades the existing `game.js` and paints only the new art with the Season 1 hero as reference. Backers become co-owners.
- **Every model call is logged** with model, tokens (cached and reasoning), cost and latency, and shown live in the crew log.

## Honesty notes
- Money is simulated demo credit (every persona starts with $2.00): no real payments. Prices and build costs are real (from Meta's token counts and the logged cost of every call). "Simulated players" comments are generated by Muse Spark and labeled as such in the UI; you can also type your own.
- Games are stored in your browser (IndexedDB). There is no account system or server database.
- Showcase games in the feed are real recorded builds made by this pipeline, shipped as static files; their buyers are demo players.

## Run it
```bash
npm install
echo "MODEL_API_KEY=..." > .env.local   # from dev.meta.ai → API keys
npm run dev
```
Optional: `OPEN_BASE_URL`, `OPEN_API_KEY`, `OPEN_MODEL` for Muse Spark Open; `SIWI_CODE_EFFORT` (default `medium`).

Headless playtest of any game file: `node scripts/playtest.mjs examples/meadow-hop.game.js`.

## Map
- `src/lib/agents.ts`: every agent's model call. `src/lib/pipeline.ts`: Siwi's tools and guardrails. `src/lib/client/runner.ts`: the loop the browser drives.
- `src/lib/callModel.ts`: the one wrapper for all model calls (usage, cost, latency, zod validation).
- `src/lib/lint.ts`: static checks. `src/lib/playtester.ts` + `public/siwi-harness.js`: the sandbox playtest.
- `src/lib/client/market.ts`: the price split and credits. `src/lib/client/wallet.ts`: demo personas and wallets.
- `prompts/*.v2.md`: versioned prompts (v1 kept for the recorded runs). `config/pricing.ts`: prices. `docs/meta-api-notes.md`: what we verified live.
- `BUILD_LOG.md`: timestamped milestones. Everything here was built during the hackathon (Oct 27 to Nov 4, 2026).
