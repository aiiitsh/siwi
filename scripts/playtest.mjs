// Headless playtest of a game.js against the kit + harness, the same way the browser Tester does it.
// Usage: node scripts/playtest.mjs examples/meadow-hop.game.js [outDir]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const file = process.argv[2];
const outDir = process.argv[3] || "/tmp/siwi-playtest";
fs.mkdirSync(outDir, { recursive: true });
const kit = fs.readFileSync("public/siwi-kit.js", "utf8");
const harness = fs.readFileSync("public/siwi-harness.js", "utf8");
const gameJs = fs.readFileSync(file, "utf8");
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="game" width="960" height="540"></canvas>
<script>${safe(harness)}</script><script>${safe(kit)}</script><script>window.SIWI_ASSETS={};</script><script>${safe(gameJs)}</script></body></html>`;

const SCRIPT = [
  { at: 300, key: "right", ms: 1500 },
  { at: 900, key: "jump", ms: 250 },
  { at: 2000, key: "right", ms: 1200 },
  { at: 2400, key: "jump", ms: 300 },
  { at: 3400, key: "action", ms: 100 },
  { at: 3600, key: "left", ms: 600 },
  { at: 4400, key: "right", ms: 2500 },
  { at: 5000, key: "jump", ms: 300 },
  { at: 6000, key: "jump", ms: 300 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
await page.setContent(`<html><body style="margin:0;background:#000"><iframe id="f" sandbox="allow-scripts" style="width:960px;height:540px;border:0"></iframe></body></html>`);
const report = await page.evaluate(({ html, SCRIPT }) => new Promise((resolve) => {
  const f = document.getElementById("f");
  const shots = [], errors = [];
  let ready = false;
  window.addEventListener("message", (ev) => {
    const m = ev.data || {};
    if (m.source !== "siwi-game") return;
    if (m.type === "siwi:error") errors.push(m.error);
    if (m.type === "siwi:screenshot") shots.push({ at: m.at, dataUrl: m.dataUrl });
    if (m.type === "siwi:ready" && !ready) { ready = true; f.contentWindow.postMessage({ type: "siwi:run", id: "t1", durationMs: 9000, script: SCRIPT, screenshotsAt: [1000, 4000, 8000] }, "*"); }
    if (m.type === "siwi:report") resolve({ ...m, shots, liveErrors: errors });
  });
  setTimeout(() => resolve({ timeout: true, ready, errors }), 20000);
  f.srcdoc = html;
}), { html, SCRIPT });
await browser.close();

const base = path.basename(file).replace(/\.js$/, "");
for (const s of report.shots || []) fs.writeFileSync(path.join(outDir, `${base}-${s.at}.jpg`), Buffer.from(s.dataUrl.split(",")[1], "base64"));
delete report.shots;
const uniq = new Set((report.frames || []).map((f) => f.hash)).size;
console.log(JSON.stringify({ errors: report.errors, liveErrors: report.liveErrors?.length, framesUnique: uniq, frames: report.frames?.length, minVariance: Math.min(...(report.frames || []).map((f) => f.variance)), first: report.states?.[0], final: report.final, events: report.events?.map((e) => e.kind).join(","), timeout: report.timeout }, null, 1));
