import "server-only";
import type OpenAI from "openai";
import { callChat, type Trace } from "./callModel";
import { MODELS } from "./meta";
import { prompt, codingContext } from "./prompts";
import { Design, CodeOut, Verdict, PatchOut, Proposal, Community, type Bug } from "./schemas";
import { lintGame, type LintResult } from "./lint";
import { allowedTools, fallbackTool, repeatedBugs, type BuildStatus, type ToolName, TOOL_NAMES } from "./pipeline";

// Measured 2026-11-03: "high" spent ~29k reasoning tokens and 4.6 min on one game.js (mostly counting
// level columns). "medium" keeps a build inside a serverless request; patches stay on "high".
const CODE_EFFORT = (process.env.SIWI_CODE_EFFORT ?? "medium") as "medium" | "high" | "low";

/* ------------------------------------------------------------------ Spark: design */
export type Material = { name: string; text?: string; image?: string };

/** Spark designs from the idea plus everything players added to the post: detail comments, notes, and pictures (vision). */
export async function runDesign(idea: string, trace: Trace[], materials: Material[] = [], by = "a player") {
  const texts = materials.filter((m) => m.text).slice(0, 30).map((m) => `- ${m.name}: ${m.text!.slice(0, 400)}`);
  const imgs = materials.filter((m) => m.image).slice(0, 4);
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{
    type: "text",
    text: `Idea posted by ${by}: "${idea.slice(0, 400)}"` +
      (texts.length ? `\n\nDetails players added in the thread:\n${texts.join("\n")}` : "") +
      (imgs.length ? `\n\nPictures players uploaded (in order): ${imgs.map((m, i) => `#${i + 1} from ${m.name}${m.text ? ` (${m.text.slice(0, 80)})` : ""}`).join(", ")}.` : ""),
  }];
  for (const m of imgs) content.push({ type: "image_url", image_url: { url: m.image!, detail: "low" } });
  const r = await callChat({
    agent: "spark", step: "design", trace, schema: Design, schemaName: "game_design", reasoningEffort: "medium",
    cacheKey: "siwi-design-v2",
    messages: [
      { role: "system", content: prompt("design.v2") },
      { role: "user", content },
    ],
  });
  return r.data;
}

export function genreOf(code: string): "platformer" | "topdown" {
  return /Siwi\.topdown\s*\(/.test(code) ? "topdown" : "platformer";
}

/* ------------------------------------------------------------------ Spark: code */
export async function runCode(design: Design, trace: Trace[]) {
  const genre = design.genre ?? "platformer";
  const r = await callChat({
    agent: "spark", step: "code", trace, schema: CodeOut, schemaName: "game_code", reasoningEffort: CODE_EFFORT,
    cacheKey: `siwi-code-v2-${genre}`, maxCompletionTokens: 40000,
    messages: [
      { role: "system", content: prompt("code.v2") + "\n\n" + codingContext(genre) },
      { role: "user", content: "Design:\n```json\n" + JSON.stringify(design, null, 1) + "\n```" },
    ],
  });
  const code = stripFences(r.data.code);
  return { code, notes: r.data.notes, lint: lintGame(code) };
}

function stripFences(s: string) {
  return s.replace(/^\s*```(?:js|javascript)?\s*\n/, "").replace(/\n```\s*$/, "").trim() + "\n";
}

/* ------------------------------------------------------------------ Tester: vision verdict */
export type PlayReport = {
  checks: { id: string; pass: boolean; detail: string }[];
  errors: { kind: string; message: string; line?: number }[];
  trail: string; // compact state/event trail made by the browser
  screenshots: string[]; // JPEG data URLs
  lint?: LintResult;
};

export async function runVerdict(design: Design | null, report: PlayReport, trace: Trace[]) {
  const failed = report.checks.filter((c) => !c.pass);
  const text = [
    `Game: ${design?.title ?? "unknown"} (${design?.genre ?? "platformer"}, lighting ${design?.lighting ?? "day"}). Special mechanic: ${design?.specialMechanic?.name ?? "none"}.`,
    "Automated checks:\n" + report.checks.map((c) => `- ${c.pass ? "PASS" : "FAIL"} ${c.id}: ${c.detail}`).join("\n"),
    report.lint?.issues.length ? "Static lint issues:\n" + report.lint.issues.map((i) => `- ${i.id}: ${i.message}${i.line ? ` (game.js line ${i.line})` : ""}`).join("\n") : "Static lint: ok",
    report.errors.length ? "Runtime errors:\n" + report.errors.slice(0, 6).map((e) => `- ${e.kind}: ${e.message}${e.line ? ` (line ${e.line})` : ""}`).join("\n") : "Runtime errors: none",
    "State/event trail:\n" + report.trail.slice(0, 3000),
    `Screenshots attached: ${report.screenshots.length} (in time order).`,
  ].join("\n\n");
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: "text", text }];
  for (const s of report.screenshots.slice(0, 4)) content.push({ type: "image_url", image_url: { url: s, detail: "low" } });
  const r = await callChat({
    agent: "tester", step: "verdict", trace, schema: Verdict, schemaName: "playtest_verdict", reasoningEffort: "medium",
    cacheKey: "siwi-tester-v2",
    messages: [{ role: "system", content: prompt("tester.v2") }, { role: "user", content }],
  });
  const v = r.data;
  // Deterministic floor: a failed automated check or lint issue always fails the build.
  const bugs: Bug[] = [...v.bugs];
  for (const c of failed) {
    if (!bugs.some((b) => b.id === `check-${c.id}`)) bugs.unshift({ id: `check-${c.id}`, title: `Automated check failed: ${c.id}`, severity: "blocker", evidence: c.detail, fixHint: "" });
  }
  for (const i of (report.lint?.issues ?? []).filter((x) => !x.warn)) {
    if (!bugs.some((b) => b.id === `lint-${i.id}`)) bugs.unshift({ id: `lint-${i.id}`, title: i.message.slice(0, 140), severity: "major", evidence: i.line ? `game.js line ${i.line}` : "static lint", fixHint: "" });
  }
  const blocking = bugs.filter((b) => b.severity !== "minor");
  return { ...v, bugs, verdict: blocking.length ? ("fail" as const) : ("pass" as const) };
}

/* ------------------------------------------------------------------ Spark / Fixer: patch */
export async function runPatch(code: string, bugs: Bug[], useWonder: boolean, trace: Trace[]) {
  const numbered = code.split("\n").map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n");
  const agentName = useWonder ? "Fixer" : "Spark";
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: prompt("patch.v1").replace("{{AGENT}}", agentName) + "\n\n" + codingContext(genreOf(code)) },
    {
      role: "user",
      content:
        "Bug reports:\n" + bugs.map((b) => `- [${b.severity}] ${b.id}: ${b.title}\n  evidence: ${b.evidence}${b.fixHint ? `\n  hint: ${b.fixHint}` : ""}`).join("\n") +
        "\n\nCurrent game.js (line numbers for reference only; they are NOT part of the file):\n```\n" + numbered + "\n```",
    },
  ];
  const opts = {
    agent: useWonder ? ("fixer" as const) : ("spark" as const), step: useWonder ? "escalate" : "patch", trace,
    schema: PatchOut, schemaName: "code_patch", reasoningEffort: "high" as const, maxCompletionTokens: 40000,
    model: useWonder ? MODELS.wonder : MODELS.spark, cacheKey: `${useWonder ? "siwi-fixer-v2" : "siwi-patch-v2"}-${genreOf(code)}`,
  };
  let r = await callChat({ ...opts, messages });
  let applied = applyEdits(code, r.data.edits);
  if (!applied.ok) {
    // one retry: show the model exactly which edit failed
    r = await callChat({
      ...opts, step: opts.step + ".retry",
      messages: [...messages, { role: "assistant", content: JSON.stringify(r.data) }, { role: "user", content: `Edit ${applied.failedIndex + 1} could not be applied: its "find" text is not an exact unique match in game.js. Return the fix again with exact snippets, or one edit with empty find and the full file.` }],
    });
    applied = applyEdits(code, r.data.edits);
  }
  if (!applied.ok) throw new Error("patch could not be applied");
  const newCode = stripFences(applied.code);
  return { code: newCode, diagnosis: r.data.diagnosis, edits: r.data.edits.length, lint: lintGame(newCode), model: opts.model };
}

export function applyEdits(code: string, edits: { find: string; replace: string }[]): { ok: true; code: string } | { ok: false; failedIndex: number } {
  let out = code;
  for (let i = 0; i < edits.length; i++) {
    const { find, replace } = edits[i];
    if (find === "") { out = replace; continue; }
    const at = out.indexOf(find);
    if (at < 0 || out.indexOf(find, at + 1) >= 0) return { ok: false, failedIndex: i };
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return { ok: true, code: out };
}

/* ------------------------------------------------------------------ Siwi: orchestrator (tool calling) */
const TOOL_DOCS: Record<ToolName, string> = {
  generate_art: "Ask Pixel (Muse Image) to paint the hero first, then all other sprites using the hero as a style reference. Runs in the background.",
  write_code: "Ask Spark to write game.js on our engine kit from the design.",
  run_playtest: "Ask Tester to play the current build in a sandbox and judge it.",
  patch_code: "Ask Spark to fix the bugs from the last playtest.",
  escalate_to_wonder: "Ask Fixer (Muse Wonder, about 4x the price) to fix a bug Spark could not. Once per build.",
  accept_build: "Ship the build to players (with known issues if any remain).",
};

export async function runDecide(status: BuildStatus, trace: Trace[]) {
  const allowed = allowedTools(status);
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOL_NAMES.map((name) => ({
    type: "function",
    function: {
      name, description: TOOL_DOCS[name],
      parameters: { type: "object", properties: { say: { type: "string", description: "One short in-character line for the players." } }, required: ["say"], additionalProperties: false },
    },
  }));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: prompt("siwi.v1") },
    { role: "user", content: "Build status:\n```json\n" + JSON.stringify({ ...status, repeatedBugs: repeatedBugs(status), allowed }, null, 1) + "\n```\nPick the next action." },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await callChat({ agent: "siwi", step: "decide", trace, messages, tools, reasoningEffort: "low", cacheKey: "siwi-decide-v1" });
      const call = r.toolCalls.find((c) => c.type === "function");
      if (call && call.type === "function" && (allowed as string[]).includes(call.function.name)) {
        let say = "";
        try { say = String(JSON.parse(call.function.arguments || "{}").say ?? ""); } catch {}
        return { tool: call.function.name as ToolName, say: say.slice(0, 200), by: "model" as const, allowed };
      }
      // Plain text or a disallowed tool: nudge once (tool_choice only supports "auto" on Meta's API).
      messages.push({ role: "assistant", content: r.text || "(no tool call)" });
      messages.push({ role: "user", content: `Please call exactly one of these tools: ${allowed.join(", ")}.` });
    } catch (e) {
      console.warn("[siwi] decide failed", e);
      break;
    }
  }
  const tool = fallbackTool(status);
  return { tool, say: "", by: "rule" as const, allowed };
}

/* ------------------------------------------------------------------ Season 2: community, proposal, upgrade */
export async function runCommunity(design: Design, trace: Trace[]) {
  const r = await callChat({
    agent: "siwi", step: "simulate_players", trace, schema: Community, schemaName: "thread", reasoningEffort: "low",
    messages: [
      { role: "system", content: "Write 5 short, varied comments from players of this browser game, in a game's discussion thread, about what they want in Season 2. Casual tone, distinct first names, a mix of: a new mechanic, a new enemy or friend, a new world/level, a quality-of-life fix, and one idea that is out of scope (multiplayer, a full open world, or similar). Gentle themes only; no violence, no brands." },
      { role: "user", content: JSON.stringify({ title: design.title, story: design.story, hero: design.hero, mechanic: design.specialMechanic, levels: design.levels }) },
    ],
  });
  return r.data.comments;
}

/** Demo players reacting to a fresh idea post: concrete details they want in the game. */
export async function runIdeaCommunity(idea: string, existing: string[], trace: Trace[]) {
  const r = await callChat({
    agent: "siwi", step: "simulate_players", trace, schema: Community, schemaName: "thread", reasoningEffort: "low",
    messages: [
      { role: "system", content: "Write 4 to 5 short comments from different players under a game idea someone posted on a game-crowdfunding feed. Each adds ONE concrete detail they'd pay for: the hero's look or name, a mechanic, a place or level, an item, a mood, a friendly critter. Casual tone, distinct first names (not Maya, Leo, Noor, Sam, Aiko, Kofi or Priya), no repeats of details already in the thread. Gentle and original only: no violence, no brands or existing characters." },
      { role: "user", content: JSON.stringify({ idea, thread: existing.slice(-12) }) },
    ],
  });
  return r.data.comments;
}

export async function runProposal(design: Design, comments: { name: string; body: string }[], trace: Trace[], useOpen = false) {
  const r = await callChat({
    agent: useOpen ? "open" : "spark", step: "proposal", trace, schema: Proposal, schemaName: "season_proposal", reasoningEffort: "medium",
    ...(useOpen ? { provider: "open" as const } : {}),
    messages: [
      {
        role: "system",
        content:
          "You are Spark. Merge a game's player thread into ONE Season 2 proposal the crew can build as an upgrade of the existing game on the same engine kit and the SAME genre (platformer: levels, collectibles, enemies, powerups, gravity flip, double jump, darkness, one custom entity type; top-down: rooms, keys and doors, lamps, chasing critters, lantern glow, dash, darkness, one custom entity type). " +
          "Keep everything that works; add 2 to 4 concrete changes, exactly one new level, and at most 3 new sprites. Credit the players who asked for each change. List ideas you leave out and why (too big, off-theme, or not possible in the kit). Gentle and original only.",
      },
      { role: "user", content: JSON.stringify({ season1: { title: design.title, genre: design.genre ?? "platformer", story: design.story, hero: design.hero, mechanic: design.specialMechanic, levels: design.levels, sprites: design.sprites.map((s) => s.name) }, thread: comments }) },
    ],
  });
  return r.data;
}

export async function runUpgradeCode(design: Design, proposal: Proposal, oldCode: string, trace: Trace[]) {
  const genre = genreOf(oldCode);
  const r = await callChat({
    agent: "spark", step: "upgrade_code", trace, schema: CodeOut, schemaName: "game_code", reasoningEffort: CODE_EFFORT,
    cacheKey: `siwi-code-v2-${genre}`, maxCompletionTokens: 40000,
    messages: [
      { role: "system", content: prompt("code.v2") + "\n\n" + codingContext(genre) },
      {
        role: "user",
        content:
          "This is a SEASON 2 UPGRADE of an existing game. Keep the existing levels, title style, palette and everything that works. Apply every change in the funded proposal, add the new level at the end (so the game has the old levels plus the new one), and use the new sprite names where they fit. Update the title to include \"Season 2\".\n\n" +
          "Season 1 design:\n```json\n" + JSON.stringify(design) + "\n```\nFunded Season 2 proposal:\n```json\n" + JSON.stringify(proposal) + "\n```\nCurrent game.js:\n```js\n" + oldCode + "\n```",
      },
    ],
  });
  const code = stripFences(r.data.code);
  return { code, notes: r.data.notes, lint: lintGame(code) };
}
