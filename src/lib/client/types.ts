import type { Design, Verdict, Proposal } from "@/lib/schemas";

export type AgentId = "siwi" | "spark" | "pixel" | "tester" | "fixer" | "open" | "system";

export type Trace = {
  agent: AgentId; step: string; model: string; costUsd: number; latencyMs: number;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; images?: number };
};

export type GameEvent = {
  t: number; // epoch ms
  season: number;
  agent: AgentId;
  kind: "say" | "decision" | "model" | "design" | "art" | "code" | "lint" | "playtest" | "bug" | "patch" | "accept" | "error" | "pledge" | "comment" | "proposal" | "info";
  msg: string;
  costUsd?: number;
  data?: Record<string, unknown>;
};

export type PatchRecord = { by: "spark" | "fixer"; model: string; diagnosis: string; before: string; after: string; bugIds: string[] };

export type TestRecord = {
  pass: boolean;
  checks: { id: string; pass: boolean; detail: string }[];
  verdict: Verdict | null;
  screenshots: string[];
};

export type SeasonRecord = {
  n: number;
  status: "building" | "ready" | "failed";
  design: Design | null;
  code: string | null;
  notes?: string;
  assets: Record<string, string>;
  refs: Record<string, string>; // mid-size reference images (hero, background) for Pixel
  test: TestRecord | null;
  tests: number;
  patches: PatchRecord[];
  costUsd: number;
  budgetUsd: number;
  startedAt: number;
  finishedAt?: number;
  knownIssues?: string[];
  proposal?: Proposal;
};

export type Comment = { id: string; name: string; body: string; t: number; simulated?: boolean };
export type Pledge = { name: string; amount: number; t: number; simulated?: boolean };
export type Owner = { name: string; season: number; amount: number };

export type ProposalRecord = {
  season: number;
  spec: Proposal;
  estimate: Estimate;
  goalUsd: number;
  pledges: Pledge[];
  status: "open" | "funded" | "building" | "built";
  openWeights?: boolean;
};

export type Estimate = {
  lines: { label: string; usd: number; detail: string }[];
  totalUsd: number;
  method: string;
};

export type GameRecord = {
  id: string;
  idea: string;
  creator: string;
  createdAt: number;
  title: string;
  cover?: string;
  showcase?: boolean;
  seasons: SeasonRecord[];
  events: GameEvent[];
  comments: Comment[];
  proposal: ProposalRecord | null;
  owners: Owner[];
};
