// Isomorphic: assembles one self-contained game HTML file (used by the browser and by server pages).

/** Prevents a literal "</script>" inside inlined JS or JSON from closing the tag early. */
function safeScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export type GameHtmlInput = {
  kit: string;
  harness: string;
  title: string;
  gameJs: string;
  /** name -> data URI. Inlined so the canvas is never cross-origin tainted. */
  assets?: Record<string, string>;
};

/**
 * Harness first (so it catches every error), then kit, assets, game code. The game code gets its own
 * <script> with a sourceURL so runtime errors report line numbers inside game.js.
 */
export function assembleGameHtml({ kit, harness, title, gameJs, assets = {} }: GameHtmlInput): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
</head>
<body><canvas id="game" width="960" height="540"></canvas>
<script>${safeScript(harness)}</script>
<script>${safeScript(kit)}</script>
<script>window.SIWI_ASSETS=${safeScript(JSON.stringify(assets))};</script>
<script>${safeScript(gameJs)}
//# sourceURL=game.js</script>
</body></html>`;
}
