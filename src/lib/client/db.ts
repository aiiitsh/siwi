"use client";
import type { GameRecord } from "./types";

// Games live in the player's browser (IndexedDB). No server database by design.
const DB = "siwi";
const STORE = "games";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveGame(g: GameRecord): Promise<void> {
  await tx("readwrite", (s) => s.put(g));
  window.dispatchEvent(new CustomEvent("siwi:game", { detail: g.id }));
}
export async function loadGame(id: string): Promise<GameRecord | null> {
  const local = await tx<GameRecord | undefined>("readonly", (s) => s.get(id));
  if (local) return local;
  return loadShowcase(id);
}
export async function listLocalGames(): Promise<GameRecord[]> {
  const all = await tx<GameRecord[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteGame(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/* Pre-built games that ship with the site (real recorded builds), so the gallery is never empty. */
export type ShowcaseEntry = { id: string; title: string; idea: string; cover?: string; seasons: number; costUsd: number; stub?: GameRecord };
export async function listShowcase(): Promise<ShowcaseEntry[]> {
  try {
    const r = await fetch("/showcase/index.json", { cache: "no-store" });
    if (!r.ok) return [];
    return (await r.json()) as ShowcaseEntry[];
  } catch {
    return [];
  }
}
async function loadShowcase(id: string): Promise<GameRecord | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(id)) return null;
  try {
    const r = await fetch(`/showcase/${id}.json`);
    if (!r.ok) return null;
    const g = (await r.json()) as GameRecord;
    return { ...g, showcase: true };
  } catch {
    return null;
  }
}

export function playerName(): string {
  try { return localStorage.getItem("siwi:name") || "You"; } catch { return "You"; }
}
export function setPlayerName(n: string) {
  try { localStorage.setItem("siwi:name", n.slice(0, 20)); } catch {}
}
