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

/** The stable prefix every coding call shares, so Meta's prompt cache can reuse it. */
export function codingContext(): string {
  return [
    prompt("kit-reference.v1"),
    "## Example game 1 (hand-written)\n```js\n" + example("meadow-hop") + "\n```",
    "## Example game 2 (hand-written)\n```js\n" + example("gravity-garden") + "\n```",
  ].join("\n\n");
}
