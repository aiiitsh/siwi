"use client";

import Link from "next/link";
import { useState } from "react";
import { PERSONAS, setViewer } from "@/lib/client/wallet";
import { useViewer, useWallet } from "@/lib/client/api";
import { money } from "@/lib/client/market";
import { Avatar } from "./Crew";

/** Site header: who you're viewing as (demo personas) and that persona's demo wallet. */
export default function TopBar() {
  const me = useViewer();
  const w = useWallet(me);
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-deep/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-black tracking-tight">
          <Avatar id="siwi" size={28} /> <span className="text-lg">Siwi</span>
        </Link>
        <span className="mono hidden rounded-full border border-gold/40 px-2 py-0.5 text-[10px] text-gold sm:inline">Demo money · no real payments</span>
        <div className="flex-1" />
        <label className="mono flex items-center gap-1.5 text-[11px] text-white/50">
          <span className="hidden sm:inline">viewing as</span>
          <select value={me} onChange={(e) => setViewer(e.target.value)} className="rounded-full border border-white/15 bg-black/40 px-2 py-1 text-xs text-white outline-none" aria-label="Viewing as">
            {PERSONAS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <div className="relative">
          <button onClick={() => setOpen((x) => !x)} className="mono rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-gold hover:bg-gold/25" aria-label="Wallet">
            ◎ {money(w.balance)}
          </button>
          {open && (
            <div className="pop-in absolute right-0 mt-2 w-80 rounded-2xl border border-white/15 bg-navy-deep p-3 shadow-2xl">
              <div className="flex items-baseline justify-between"><b>{me}&apos;s wallet</b><span className="mono text-gold">{money(w.balance)}</span></div>
              <p className="mt-1 text-[11px] text-white/50">Demo credits. Buying into a game spends them; when later players buy the same game, your share drops and the difference comes back here.</p>
              <div className="scroll-thin mt-2 max-h-64 space-y-1 overflow-y-auto">
                {w.history.length === 0 && <p className="text-xs text-white/40">No activity yet.</p>}
                {w.history.map((h, i) => (
                  <Link key={i} href={`/g/${h.gameId}`} onClick={() => setOpen(false)} className="flex items-start justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-white/5">
                    <span className="text-white/75">{h.note}</span>
                    <span className={`mono shrink-0 ${h.usd > 0 ? "text-tester" : "text-white/60"}`}>{h.usd > 0 ? "+" : ""}{money(h.usd)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
