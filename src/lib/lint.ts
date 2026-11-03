import "server-only";
import vm from "node:vm";

// Static checks on a generated game.js before the Tester ever plays it:
// does it parse, does it call Siwi.platformer exactly once, and are its levels well-formed?
// Runs the code in a throwaway VM context with a stub kit that only records the config.

export type LintIssue = { id: string; message: string; line?: number; warn?: boolean };
export type LintResult = { ok: boolean; issues: LintIssue[]; stats: { levels: number; cols: number[]; collectibles: number[]; enemies: number[] } };

const KNOWN_TYPES = new Set(["solid", "oneway", "player", "collectible", "enemy", "hazard", "goal", "powerup", "checkpoint", "custom"]);
const DEFAULT_CHARS = new Set(["#", "=", "-", "P", "C", "E", "F", "^", "G", "U", "K", "."]);

export function lintGame(code: string): LintResult {
  const issues: LintIssue[] = [];
  const stats = { levels: 0, cols: [] as number[], collectibles: [] as number[], enemies: [] as number[] };
  let script: vm.Script;
  try {
    script = new vm.Script(code, { filename: "game.js" });
  } catch (e) {
    const m = /game\.js:(\d+)/.exec(String((e as Error).stack));
    issues.push({ id: "syntax-error", message: `SyntaxError: ${(e as Error).message}`, line: m ? Number(m[1]) : undefined });
    return { ok: false, issues, stats };
  }

  const configs: Record<string, unknown>[] = [];
  const noop = () => {};
  const api = new Proxy({}, { get: () => noop });
  const Siwi = {
    platformer: (cfg: Record<string, unknown>) => { configs.push(cfg); return api; },
    createGame: noop, loadImages: noop, drawSprite: noop, text: noop,
    clamp: (x: number, a: number, b: number) => Math.max(a, Math.min(b, x)), lerp: (a: number, b: number, k: number) => a + (b - a) * k,
    rand: (a: number, b: number) => a + Math.random() * (b - a), W: 960, H: 540, TILE: 48, input: api, audio: api, sfx: api,
  };
  const win: Record<string, unknown> = { SIWI_ASSETS: {}, Siwi, addEventListener: noop, requestAnimationFrame: noop };
  win.window = win;
  const ctx = vm.createContext({ ...win, console: { log: noop, warn: noop, error: noop }, Math, JSON, performance: { now: () => 0 } });
  try {
    script.runInContext(ctx, { timeout: 500 });
  } catch (e) {
    const m = /game\.js:(\d+)/.exec(String((e as Error).stack));
    issues.push({ id: "runtime-error", message: `Error while loading: ${(e as Error).message}`, line: m ? Number(m[1]) : undefined });
    return { ok: false, issues, stats };
  }
  if (configs.length !== 1) {
    issues.push({ id: "platformer-call", message: `Siwi.platformer must be called exactly once (called ${configs.length} times)` });
    return { ok: false, issues, stats };
  }
  const cfg = configs[0] as { legend?: Record<string, { type?: string }>; levels?: { name?: string; rows?: unknown }[] };
  const legend = cfg.legend ?? {};
  for (const [ch, def] of Object.entries(legend)) {
    if (ch.length !== 1) issues.push({ id: "legend-key", message: `legend key "${ch}" must be a single character` });
    if (!def || !KNOWN_TYPES.has(String(def.type))) issues.push({ id: "legend-type", message: `legend "${ch}" has unknown type "${def?.type}"` });
  }
  const chars = new Set([...DEFAULT_CHARS, ...Object.keys(legend)]);
  const typeOf = (ch: string) => legend[ch]?.type ?? ({ P: "player", G: "goal", C: "collectible", E: "enemy", F: "enemy" } as Record<string, string>)[ch];
  const levels = Array.isArray(cfg.levels) ? cfg.levels : [];
  if (!levels.length) issues.push({ id: "no-levels", message: "config.levels is empty" });
  stats.levels = levels.length;
  levels.forEach((L, i) => {
    const tag = `level ${i + 1} "${L?.name ?? "?"}"`;
    const rows = L?.rows;
    if (!Array.isArray(rows) || rows.some((r) => typeof r !== "string")) { issues.push({ id: "level-rows", message: `${tag}: rows must be an array of strings` }); return; }
    const lens = new Set(rows.map((r: string) => r.length));
    if (lens.size > 1) issues.push({ id: "ragged-rows", warn: true, message: `${tag}: rows have different lengths (${[...lens].join(", ")}); the kit pads them` });
    if (rows.length < 8 || rows.length > 16) issues.push({ id: "level-height", warn: true, message: `${tag}: ${rows.length} rows (expected 11 to 13)` });
    const flat = rows.join("");
    let p = 0, g = 0, col = 0, en = 0;
    const unknown = new Set<string>();
    for (const ch of flat) {
      const t = typeOf(ch);
      if (t === "player") p++;
      if (t === "goal") g++;
      if (t === "collectible") col++;
      if (t === "enemy") en++;
      if (!chars.has(ch) && ch !== " ") unknown.add(ch);
    }
    if (p !== 1) issues.push({ id: "player-count", message: `${tag}: needs exactly one player start, found ${p}` });
    if (g < 1) issues.push({ id: "no-goal", message: `${tag}: has no goal` });
    if (unknown.size) issues.push({ id: "unknown-chars", message: `${tag}: characters not in legend: ${[...unknown].join(" ")}` });
    // the player start must not be inside a solid tile
    rows.forEach((r: string, ri: number) => {
      const ci = r.indexOf("P");
      if (ci >= 0) {
        const below = rows.slice(ri + 1).some((rr: string) => typeOf(rr[ci]) === "solid" || rr[ci] === "#" || rr[ci] === "=" || rr[ci] === "-");
        if (!below) issues.push({ id: "player-no-floor", message: `${tag}: no ground anywhere below the player start (column ${ci})` });
      }
    });
    stats.cols.push(Math.max(...rows.map((r: string) => r.length)));
    stats.collectibles.push(col);
    stats.enemies.push(en);
  });
  return { ok: !issues.some((i) => !i.warn), issues, stats };
}
