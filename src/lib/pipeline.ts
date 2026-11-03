// Shared by the browser (which drives the build) and the server (which validates Siwi's choices).

export const TOOL_NAMES = ["generate_art", "write_code", "run_playtest", "patch_code", "escalate_to_wonder", "accept_build"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const CAPS = { patchLoops: 3, wonder: 1, imagesPerGame: 20 };
export const BUDGET_USD = { season1: 1.0, season2: 1.0 };

export type BuildStatus = {
  season: number;
  art: "none" | "running" | "done" | "failed";
  code: "none" | "untested" | "tested";
  lastTest: { pass: boolean; bugIds: string[]; summary: string } | null;
  previousBugIds: string[];
  patchLoops: number;
  maxPatchLoops: number;
  wonderUsed: boolean;
  spentUsd: number;
  budgetUsd: number;
};

/** Hard guardrails: the set of tools Siwi may pick from in this state. */
export function allowedTools(s: BuildStatus): ToolName[] {
  const out: ToolName[] = [];
  const artFree = s.art === "none";
  const overBudget = s.spentUsd >= s.budgetUsd;
  if (s.code === "none") {
    if (artFree) out.push("generate_art");
    out.push("write_code");
    return out;
  }
  if (s.code === "untested") {
    out.push("run_playtest");
    if (artFree) out.push("generate_art");
    return out;
  }
  // tested
  if (artFree) out.push("generate_art");
  if (s.lastTest?.pass) { out.push("accept_build"); return out; }
  const loopsLeft = s.patchLoops < s.maxPatchLoops && !overBudget;
  if (loopsLeft) {
    out.push("patch_code");
    if (!s.wonderUsed) out.push("escalate_to_wonder");
  } else {
    out.push("accept_build");
  }
  return out;
}

export function repeatedBugs(s: BuildStatus): string[] {
  const prev = new Set(s.previousBugIds);
  return (s.lastTest?.bugIds ?? []).filter((id) => prev.has(id));
}

/** Deterministic fallback when the model gives no usable tool call. */
export function fallbackTool(s: BuildStatus): ToolName {
  const allowed = allowedTools(s);
  if (allowed.includes("generate_art")) return "generate_art";
  if (allowed.includes("write_code")) return "write_code";
  if (allowed.includes("run_playtest")) return "run_playtest";
  if (allowed.includes("accept_build")) return "accept_build";
  if (allowed.includes("escalate_to_wonder") && repeatedBugs(s).length) return "escalate_to_wonder";
  return "patch_code";
}
