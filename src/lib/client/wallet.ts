"use client";
// Demo identities and wallets. Everything is simulated and lives in this browser (no real payments).

export const PERSONAS = ["You", "Maya", "Leo", "Noor", "Sam", "Aiko", "Kofi", "Priya"] as const;
export const START_BALANCE = 2;

export type WalletTx = { t: number; usd: number; kind: "buy" | "credit"; gameId: string; note: string };
export type Wallet = { balance: number; history: WalletTx[] };

const KEY = "siwi:wallets";
const NAME_KEY = "siwi:name";

function readAll(): Record<string, Wallet> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function writeAll(w: Record<string, Wallet>) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch {}
  window.dispatchEvent(new CustomEvent("siwi:wallet"));
}

export function wallet(name: string): Wallet {
  return readAll()[name] ?? { balance: START_BALANCE, history: [] };
}
export function walletTx(name: string, usd: number, kind: WalletTx["kind"], gameId: string, note: string) {
  const all = readAll();
  const w = all[name] ?? { balance: START_BALANCE, history: [] };
  w.balance = Math.round((w.balance + usd) * 1e6) / 1e6;
  w.history = [{ t: Date.now(), usd, kind, gameId, note }, ...w.history].slice(0, 60);
  all[name] = w;
  writeAll(all);
}

export function viewer(): string {
  try { return localStorage.getItem(NAME_KEY) || "You"; } catch { return "You"; }
}
export function setViewer(n: string) {
  try { localStorage.setItem(NAME_KEY, n.slice(0, 20)); } catch {}
  window.dispatchEvent(new CustomEvent("siwi:viewer"));
}
