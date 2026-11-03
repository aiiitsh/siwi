"use client";
import type { GameRecord, Round, Buyer, SeasonRecord } from "./types";
import { walletTx } from "./wallet";

// The co-ownership market: one price per season, split equally across everyone who buys in.
// When someone new buys, everyone's share drops to price / buyers and earlier buyers get the
// difference back as wallet credits. The total collected always equals the price.

export const money = (x: number) => (Math.abs(x) >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(3)}`);

export function netPaid(b: Buyer) { return b.paid - b.credited; }

/** Share the NEXT buyer would pay. */
export function nextShare(r: Round) { return r.priceUsd / (r.buyers.length + 1); }

export type BuyResult = { share: number; refunds: { name: string; usd: number }[] };

/** Pure split math: adds a buyer and returns the refunds owed to earlier buyers. */
export function applyBuy(r: Round, name: string, simulated = false): BuyResult {
  const share = nextShare(r);
  const refunds: { name: string; usd: number }[] = [];
  for (const b of r.buyers) {
    const refund = netPaid(b) - share;
    if (refund > 1e-9) { b.credited += refund; refunds.push({ name: b.name, usd: refund }); }
  }
  r.buyers.push({ name, t: Date.now(), paid: share, credited: 0, simulated });
  return { share, refunds };
}

/** Applies a buy-in to the game and moves the (simulated) money between wallets. */
export function buyIn(g: GameRecord, season: number, name: string, simulated = false): BuyResult | null {
  const r = roundFor(g, season);
  if (!r || r.buyers.some((b) => b.name === name)) return null;
  const res = applyBuy(r, name, simulated);
  walletTx(name, -res.share, "buy", g.id, `Bought into ${g.title} S${season}`);
  for (const f of res.refunds) walletTx(f.name, f.usd, "credit", g.id, `${name} joined ${g.title} S${season}: your share dropped`);
  g.events.push({
    t: Date.now(), season, agent: "system", kind: "pledge",
    msg: `${name} bought in for ${money(res.share)}${simulated ? " (demo player)" : ""}. ${res.refunds.length ? `${res.refunds.length} earlier buyer${res.refunds.length > 1 ? "s each" : ""} got ${money(res.refunds[0].usd)} back as credits.` : "First buyer covers the whole price."}`,
  });
  return res;
}

export function roundFor(g: GameRecord, season: number): Round | null {
  return g.rounds?.find((r) => r.season === season) ?? null;
}

export function owns(g: GameRecord, season: number, name: string) {
  return !!roundFor(g, season)?.buyers.some((b) => b.name === name);
}

/** A buyer of a later season also gets the earlier ones (each season contains the previous levels). */
export function canPlay(g: GameRecord, season: number, name: string) {
  return (g.rounds ?? []).some((r) => r.season >= season && r.buyers.some((b) => b.name === name));
}

export function owners(g: GameRecord): { name: string; seasons: number[] }[] {
  const m = new Map<string, number[]>();
  for (const r of g.rounds ?? []) for (const b of r.buyers) m.set(b.name, [...(m.get(b.name) ?? []), r.season]);
  return [...m.entries()].map(([name, seasons]) => ({ name, seasons }));
}

export type Stage = "idea" | "priced" | "funded" | "building" | "playable" | "failed";
export function stageOf(g: GameRecord): Stage {
  const s1 = g.seasons.find((s) => s.n === 1);
  if (!s1) return "idea";
  if (s1.status === "draft") return (roundFor(g, 1)?.buyers.length ?? 0) > 0 ? "funded" : "priced";
  if (s1.status === "building") return "building";
  if (s1.status === "failed") return "failed";
  return "playable";
}
export const STAGE_LABEL: Record<Stage, string> = {
  idea: "Idea · gathering details", priced: "Priced · waiting for buyers", funded: "Funded · ready to build",
  building: "Crew is building", playable: "Playable", failed: "Build failed",
};

/** Older records (v1 pledges, showcase files) become v2 rounds so the market works on them too. */
export function normalize(g: GameRecord): GameRecord {
  g.upvotes ??= [];
  g.images ??= [];
  g.owners ??= [];
  if (!g.rounds) {
    g.rounds = [];
    for (const s of g.seasons.filter((x) => x.status === "ready")) {
      const own = g.owners.filter((o) => o.season === s.n);
      const price = Math.max(0.01, Math.ceil((s.costUsd || 0.2) * 100) / 100);
      const r: Round = { season: s.n, priceUsd: price, estimate: { lines: [{ label: "Actual build cost", usd: s.costUsd, detail: "recorded run" }], totalUsd: s.costUsd, method: "recorded run" }, buyers: [], status: "built", pricedAt: s.startedAt };
      for (const o of own) applyBuy(r, o.name === "You" ? g.creator : o.name, true);
      g.rounds.push(r);
    }
  }
  for (const s of g.seasons) if (s.design) { s.design.genre ??= "platformer"; s.design.lighting ??= "day"; s.design.credits ??= []; }
  return g;
}

export function seasonTitle(s: SeasonRecord | undefined, fallback: string) {
  return s?.design?.title ?? fallback;
}
