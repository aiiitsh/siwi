import fs from "node:fs";
import path from "node:path";

let kitCache: string | null = null;
let harnessCache: string | null = null;

export function readKit(): string {
  if (kitCache === null) kitCache = fs.readFileSync(path.join(process.cwd(), "public", "siwi-kit.js"), "utf8");
  return kitCache;
}
export function readHarness(): string {
  if (harnessCache === null) harnessCache = fs.readFileSync(path.join(process.cwd(), "public", "siwi-harness.js"), "utf8");
  return harnessCache;
}

/** Prevents a literal "</script>" inside inlined JS or JSON from closing the tag early. */
function safeScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export type GameHtmlInput = {
  title: string;
  gameJs: string;
  /** name -> data URI. Inlined so the canvas is never cross-origin tainted. */
  assets?: Record<string, string>;
};

/**
 * One self-contained HTML file: harness first (so it catches every error), then kit, assets, game code.
 * The game code gets its own <script> so a syntax error in it is reported through window.onerror.
 */
export function buildGameHtml({ title, gameJs, assets = {} }: GameHtmlInput): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body><canvas id="game" width="960" height="540"></canvas>
<script>${safeScript(readHarness())}</script>
<script>${safeScript(readKit())}</script>
<script>window.SIWI_ASSETS=${safeScript(JSON.stringify(assets))};</script>
<script>${safeScript(gameJs)}</script>
</body></html>`;
}
