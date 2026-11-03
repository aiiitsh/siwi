"use client";
import { useEffect, useState } from "react";
import type { GameRecord, GameEvent, Trace } from "./types";
import { viewer, wallet, type Wallet } from "./wallet";

/** Calls one stateless agent route (one retry on server errors). */
export async function agent<T = Record<string, unknown>>(step: string, body: unknown): Promise<T & { trace: Trace[] }> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`/api/agent/${step}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.ok) return j;
      last = j.error ?? `HTTP ${r.status}`;
      if (r.status < 500) break;
    } catch (e) {
      last = String(e);
    }
  }
  throw new Error(`${step} failed: ${last}`);
}

export function traceCost(trace: Trace[]) { return trace.reduce((a, t) => a + t.costUsd, 0); }

/** Records model calls made outside a build (pricing, simulated players) in the game's log. */
export function logTrace(g: GameRecord, season: number, trace: Trace[]) {
  for (const t of trace) {
    const ev: GameEvent = { t: Date.now(), season, agent: t.agent, kind: "model", msg: `${t.step} · ${t.model} · ${(t.latencyMs / 1000).toFixed(1)}s`, costUsd: t.costUsd, data: { ...t } };
    g.events.push(ev);
  }
}

export function useViewer(): string {
  const [me, setMe] = useState("You");
  useEffect(() => {
    const f = () => setMe(viewer());
    f();
    window.addEventListener("siwi:viewer", f);
    return () => window.removeEventListener("siwi:viewer", f);
  }, []);
  return me;
}

export function useWallet(name: string): Wallet {
  const [w, setW] = useState<Wallet>({ balance: 0, history: [] });
  useEffect(() => {
    const f = () => setW(wallet(name));
    f();
    window.addEventListener("siwi:wallet", f);
    return () => window.removeEventListener("siwi:wallet", f);
  }, [name]);
  return w;
}
