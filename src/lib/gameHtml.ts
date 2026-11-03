import fs from "node:fs";
import path from "node:path";
import { assembleGameHtml } from "./html";

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

/** Server-side convenience wrapper (example pages). */
export function buildGameHtml(i: { title: string; gameJs: string; assets?: Record<string, string> }): string {
  return assembleGameHtml({ kit: readKit(), harness: readHarness(), ...i });
}
