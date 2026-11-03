// Turns a recorded game (an IndexedDB record dumped by the e2e script) into a static showcase file.
// Usage: node scripts/export-showcase.mjs <game.json> <slug> [creatorName]
// Writes public/showcase/<slug>.json and updates public/showcase/index.json.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [file, slug, creatorArg] = process.argv.slice(2);
if (!file || !/^[a-z0-9-]{3,60}$/.test(slug ?? "")) {
  console.error("usage: node scripts/export-showcase.mjs <game.json> <slug> [creatorName]");
  process.exit(1);
}
const g = JSON.parse(fs.readFileSync(file, "utf8"));
const creator = creatorArg || (g.creator === "You" ? "Ahmed" : g.creator);
const rename = (n) => (n === "You" ? creator : n);
const ready = g.seasons.filter((s) => s.status === "ready");
const keepSeasons = new Set(ready.map((s) => s.n));
const out = {
  ...g,
  id: slug,
  creator,
  showcase: true,
  // a recorded idea that was never built keeps its draft season so the feed shows the funding stage
  seasons: ready.length ? ready : g.seasons.filter((s) => s.status === "draft"),
  proposal: g.proposal && g.proposal.status === "built" ? g.proposal : null,
  comments: g.comments.filter((c) => !ready.length || keepSeasons.has(c.season ?? 1) || (c.season ?? 1) === 1).map((c) => ({ ...c, name: rename(c.name) })),
  upvotes: (g.upvotes ?? []).map(rename),
  rounds: g.rounds === undefined ? undefined : g.rounds.filter((r) => !ready.length || keepSeasons.has(r.season)).map((r) => ({ ...r, buyers: r.buyers.map((b) => ({ ...b, name: rename(b.name), simulated: true })) })),
  owners: (g.owners ?? []).map((o) => ({ ...o, name: rename(o.name) })),
  events: g.events.filter((e) => !ready.length || keepSeasons.has(e.season)).map((e) => ({ ...e, msg: e.msg.replace(/\bYou\b/g, creator) })),
};
for (const s of out.seasons) if (s.design?.credits) s.design.credits = s.design.credits.map((c) => ({ ...c, name: rename(c.name) }));
const dir = path.join("public", "showcase");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(out));
const idxFile = path.join(dir, "index.json");
const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, "utf8")) : [];
const last = out.seasons.at(-1);
const coverSrc = out.cover ?? last?.assets?.cover;
const thumb = coverSrc ? "data:image/jpeg;base64," + (await sharp(Buffer.from(coverSrc.split(",")[1], "base64")).resize(400, 225, { fit: "cover" }).jpeg({ quality: 72 }).toBuffer()).toString("base64") : undefined;
const entry = {
  id: slug,
  title: last?.design?.title ?? out.title,
  idea: out.idea,
  cover: undefined,
  seasons: ready.length,
  costUsd: ready.reduce((a, s) => a + s.costUsd, 0),
  // a light copy for the feed card, so the home page doesn't download every full game
  stub: {
    id: slug, title: last?.design?.title ?? out.title, idea: out.idea, creator, createdAt: out.createdAt, cover: thumb,
    showcase: true, upvotes: out.upvotes, images: [], proposal: null, owners: out.owners, events: [],
    rounds: out.rounds?.map((r) => ({ ...r, estimate: { lines: [], totalUsd: r.estimate.totalUsd, method: r.estimate.method } })),
    seasons: out.seasons.map((s) => ({ n: s.n, status: s.status, design: null, code: null, assets: {}, refs: {}, test: null, tests: 0, patches: [], costUsd: s.costUsd, budgetUsd: s.budgetUsd, startedAt: s.startedAt })),
    comments: out.comments.map((c) => ({ ...c, image: undefined })),
  },
};
const next = [entry, ...idx.filter((e) => e.id !== slug)];
fs.writeFileSync(idxFile, JSON.stringify(next, null, 1));
console.log(`wrote ${slug}.json (${(fs.statSync(path.join(dir, `${slug}.json`)).size / 1024).toFixed(0)} KB); index has ${next.length}`);
