import "server-only";
import { db } from "./supabase";

export type Agent = "siwi" | "spark" | "pixel" | "tester" | "fixer" | "open" | "system";

export type EventInput = {
  gameId?: string | null;
  season?: number;
  agent: Agent;
  kind: string; // e.g. model_call, design, art, code, playtest, bug, patch, decision, accept
  message: string;
  payload?: Record<string, unknown>;
  costUsd?: number;
};

/** Writes an event row so the UI (and a refresh) can replay progress. Never throws. */
export async function writeEvent(e: EventInput): Promise<void> {
  const client = db();
  if (!client || !e.gameId) {
    console.log(`[event] ${e.agent}/${e.kind}: ${e.message}`, e.costUsd ? `$${e.costUsd.toFixed(5)}` : "");
    return;
  }
  const { error } = await client.from("events").insert({
    game_id: e.gameId,
    season: e.season ?? 1,
    agent: e.agent,
    kind: e.kind,
    message: e.message,
    payload: e.payload ?? {},
    cost_usd: e.costUsd ?? 0,
  });
  if (error) console.error("[event] insert failed:", error.message);
}
