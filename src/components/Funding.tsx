"use client";

import { useState } from "react";
import type { GameRecord, Round } from "@/lib/client/types";
import { buyIn, money, netPaid, nextShare } from "@/lib/client/market";
import { PERSONAS, wallet } from "@/lib/client/wallet";

type Props = {
  game: GameRecord;
  round: Round;
  me: string;
  save: (g: GameRecord) => Promise<void> | void;
  /** shown while the round is open and at least one buyer is in */
  onStart?: () => void;
  late?: boolean;
};

/** Price, the live split, the buy button and the ledger of who paid and who got credits back. */
export default function Funding({ game, round, me, save, onStart, late }: Props) {
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = round.buyers.length;
  const mine = round.buyers.find((b) => b.name === me);
  const share = nextShare(round);
  const refundEach = n ? round.priceUsd / n - share : 0;

  async function buy(name: string, simulated = false) {
    if (wallet(name).balance < nextShare(round) - 1e-9) { setFlash(`${name} doesn't have enough demo credits.`); return; }
    const r = buyIn(game, round.season, name, simulated);
    if (!r) return;
    setFlash(r.refunds.length
      ? `${name} paid ${money(r.share)}. ${r.refunds.map((x) => x.name).join(", ")} each got ${money(r.refunds[0].usd)} back as credits.`
      : `${name} paid ${money(r.share)} and covers the whole price. The next buyer halves it.`);
    await save(game);
  }
  async function demoBuyers() {
    setBusy(true);
    const others = PERSONAS.filter((p) => p !== me && !round.buyers.some((b) => b.name === p)).slice(0, 3);
    for (const p of others) { await buy(p, true); await new Promise((r) => setTimeout(r, 1100)); }
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-gold/30 bg-gold/[.05] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="mono text-[10px] uppercase tracking-widest text-gold">Season {round.season} price · priced by Siwi from real token counts</div>
          <div className="text-3xl font-black text-gold">{money(round.priceUsd)}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black">{n}</div>
          <div className="mono text-[10px] uppercase tracking-widest text-white/50">buyer{n === 1 ? "" : "s"}{n ? ` · ${money(round.priceUsd / n)} each` : ""}</div>
        </div>
      </div>

      <details className="rounded-xl bg-black/20 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-bold text-white/80">How the price was estimated</summary>
        <table className="mono mt-2 w-full text-[11px]"><tbody>
          {round.estimate.lines.map((l) => (
            <tr key={l.label} className="align-top"><td className="py-0.5 pr-2 text-white/80">{l.label}<div className="text-[10px] text-white/40">{l.detail}</div></td><td className="py-0.5 text-right text-gold">${l.usd.toFixed(4)}</td></tr>
          ))}
          <tr className="border-t border-white/10"><td className="pt-1 font-bold">Total</td><td className="pt-1 text-right font-bold text-gold">${round.estimate.totalUsd.toFixed(4)}</td></tr>
        </tbody></table>
        <div className="mono mt-1 text-[10px] text-white/40">{round.estimate.method}. The crew can only spend this budget.</div>
      </details>

      {!mine ? (
        <div className="rounded-xl border border-gold/40 bg-black/30 p-3">
          <div className="text-sm">{late ? "Buy in to play" : "Buy in now"} as <b>{me}</b> for <b className="text-gold">{money(share)}</b>
            {n > 0 && <span className="text-white/60">, and the {n} player{n > 1 ? "s" : ""} already in each get <b className="text-tester">{money(refundEach)}</b> back.</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => buy(me)} className="rounded-full bg-gold px-5 py-2 text-sm font-extrabold text-navy shadow-[0_0_24px_-6px_#FFC83D] hover:scale-[1.03]">Buy in · {money(share)}</button>
            <button onClick={demoBuyers} disabled={busy} className="rounded-full border border-gold/40 px-4 py-2 text-sm text-gold disabled:opacity-40">{busy ? "demo players buying…" : "+ 3 demo buyers"}</button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-tester/40 bg-tester/10 p-3 text-sm">
          You&apos;re in. You paid {money(mine.paid)}{mine.credited > 0 && <>, got <b className="text-tester">{money(mine.credited)}</b> back as later players joined</>}. Your share now: <b>{money(netPaid(mine))}</b>.
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={demoBuyers} disabled={busy} className="rounded-full border border-gold/40 px-4 py-1.5 text-xs text-gold disabled:opacity-40">{busy ? "demo players buying…" : "+ 3 demo buyers (watch your share drop)"}</button>
          </div>
        </div>
      )}

      {flash && <p className="pop-in mono text-[11px] text-gold">{flash}</p>}

      {n > 0 && (
        <table className="mono w-full text-[11px]">
          <thead><tr className="text-white/40"><th className="text-left font-normal">buyer</th><th className="text-right font-normal">paid</th><th className="text-right font-normal">credits back</th><th className="text-right font-normal">share now</th></tr></thead>
          <tbody>
            {round.buyers.map((b) => (
              <tr key={b.name} className={`pop-in ${b.name === me ? "text-white" : "text-white/75"}`}>
                <td>{b.name}{b.simulated ? <span className="text-white/35"> demo</span> : null}</td>
                <td className="text-right">{money(b.paid)}</td>
                <td className="text-right text-tester">{b.credited > 0 ? `+${money(b.credited)}` : "—"}</td>
                <td className="text-right text-gold">{money(netPaid(b))}</td>
              </tr>
            ))}
            <tr className="border-t border-white/10"><td className="pt-1 text-white/50">collected</td><td colSpan={3} className="pt-1 text-right text-gold">{money(round.buyers.reduce((a, b) => a + netPaid(b), 0))} = price</td></tr>
          </tbody>
        </table>
      )}

      {onStart && round.status === "open" && n > 0 && (
        <button onClick={onStart} className="w-full rounded-full bg-siwi px-5 py-3 font-extrabold text-navy shadow-[0_0_30px_-6px_#FF6FA5] hover:scale-[1.01]">
          Funded ✓ Start the build
        </button>
      )}
      <p className="text-[11px] text-white/45">Every buyer co-owns Season {round.season} and can play it. Players can keep buying after it ships: each new buyer lowers everyone&apos;s share and the difference returns as credits to spend on other games.</p>
    </div>
  );
}
