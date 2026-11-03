# Siwi

**Type one sentence. A crew of AI agents running on Meta's models builds a playable browser game for a few cents. Players who chip in co-own it, and vote and pay together for Season 2.**

- **Hackathon:** Meta Global AI Developer Hackathon, Indie Developer track
- **Problem statement:** Build for Your World
- **Meta models used:** Muse Spark (orchestration, design, code, vision playtesting), Muse Image (all sprites, backgrounds and cover art), Muse Wonder (escalation fixer), Muse Spark Open (open mode). Details are in [docs/meta-api-notes.md](docs/meta-api-notes.md).

> Work in progress. See [BUILD_LOG.md](BUILD_LOG.md) for what has been built so far.

## Run locally
```bash
cp .env.example .env.local   # add MODEL_API_KEY and Supabase keys
npm install
npm run dev
# smoke tests: http://localhost:3000/api/health/spark and /api/health/image
```
