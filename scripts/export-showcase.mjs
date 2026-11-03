// Turns a recorded game (an IndexedDB record dumped by the e2e script) into a static showcase file.
// Usage: node scripts/export-showcase.mjs <game.json> <slug>
// Writes public/showcase/<slug>.json and updates public/showcase/index.json.
import fs from "node:fs";
import path from "node:path";

const [file, slug] = process.argv.slice(2);
if (!file || !/^[a-z0-9-]{3,60}$/.test(slug ?? "")) {
  console.error("usage: node scripts/export-showcase.mjs <game.json> <slug>");
  process.exit(1);
}
const g = JSON.parse(fs.readFileSync(file, "utf8"));
const ready = g.seasons.filter((s) => s.status === "ready");
if (!ready.length) throw new Error("game has no finished season");
const out = {
  ...g,
  id: slug,
  creator: g.creator === "You" ? "Ahmed" : g.creator,
  showcase: true,
  seasons: ready,
  // the browser's in-progress Season N+1 thread/proposal is not part of the recording
  proposal: g.proposal && g.proposal.status === "built" ? g.proposal : null,
  comments: g.comments.filter((c) => ready.some((s) => s.n === (c.season ?? 2))),
};
for (const o of out.owners) if (o.name === "You") o.name = out.creator;
const dir = path.join("public", "showcase");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(out));
const idxFile = path.join(dir, "index.json");
const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, "utf8")) : [];
const entry = {
  id: slug,
  title: ready.at(-1).design?.title ?? out.title,
  idea: out.idea,
  cover: out.cover ?? ready.at(-1).assets.cover,
  seasons: ready.length,
  costUsd: ready.reduce((a, s) => a + s.costUsd, 0),
};
const next = [entry, ...idx.filter((e) => e.id !== slug)];
fs.writeFileSync(idxFile, JSON.stringify(next, null, 1));
console.log(`wrote ${slug}.json (${(fs.statSync(path.join(dir, `${slug}.json`)).size / 1024).toFixed(0)} KB); index has ${next.length}`);
