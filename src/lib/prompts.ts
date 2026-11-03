import "server-only";
import fs from "node:fs";
import path from "node:path";

const cache = new Map<string, string>();

/** Reads a versioned prompt file from prompts/ (e.g. "design.v1"). */
export function prompt(name: string): string {
  let s = cache.get(name);
  if (s === undefined) {
    s = fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
    cache.set(name, s);
  }
  return s;
}

export function example(name: string): string {
  const key = `example:${name}`;
  let s = cache.get(key);
  if (s === undefined) {
    s = fs.readFileSync(path.join(process.cwd(), "examples", `${name}.game.js`), "utf8");
    cache.set(key, s);
  }
  return s;
}

/** The stable prefix every coding call shares (per genre), so Meta's prompt cache can reuse it. */
export function codingContext(genre: string = "platformer"): string {
  const examples = genre === "topdown" ? ["candle-manor"] : ["meadow-hop", "gravity-garden"];
  return [
    prompt("kit-reference.v2"),
    ...examples.map((e, i) => `## Example ${genre} game ${i + 1} (hand-written)\n\`\`\`js\n` + example(e) + "\n\`\`\`"),
  ].join("\n\n");
}
