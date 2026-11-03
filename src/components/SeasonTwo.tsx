"use client";

import { useState } from "react";
import type { GameRecord, Comment, ProposalRecord } from "@/lib/client/types";
import type { Proposal } from "@/lib/schemas";
import { saveGame, playerName } from "@/lib/client/db";
import { newSeason, round2 } from "@/lib/client/runner";
import { Avatar } from "./Crew";

type Props = { game: GameRecord; setGame: (g: GameRecord) => void; startSeason: (n: number) => void; busy: boolean };

async function post(step: string, body: unknown) {
  const r = await fetch(`/api/agent/${step}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "failed");
  return j;
}

const DEMO_BACKERS = ["Maya", "Jonah", "Priya", "Leo", "Aiko", "Sam", "Noor", "Theo"];

export default function SeasonTwo({ game, setGame, startSeason, busy }: Props) {
  const latest = game.seasons[game.seasons.length - 1];
  const nextN = latest.n + 1;
  const prop = game.proposal && game.proposal.season === nextN ? game.proposal : null;
  const [text, setText] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const me = playerName();

  const update = async (g: GameRecord) => { setGame({ ...g }); await saveGame(g); };
  const addEvent = (g: GameRecord, agent: GameRecord["events"][number]["agent"], kind: GameRecord["events"][number]["kind"], msg: string, costUsd?: number) =>
    g.events.push({ t: Date.now(), season: nextN, agent, kind, msg, costUsd });

  async function addComment(name: string, body: string, simulated = false) {
    const c: Comment = { id: Math.random().toString(36).slice(2), name, body, t: Date.now(), simulated };
    game.comments.push(c);
    await update(game);
  }

  async function simulatePlayers() {
    setWorking("players"); setErr(null);
    try {
      const j = await post("community", { design: latest.design });
      for (const c of j.comments as { name: string; body: string }[]) game.comments.push({ id: Math.random().toString(36).slice(2), name: c.name, body: c.body, t: Date.now(), simulated: true });
      const cost = (j.trace as { costUsd: number }[]).reduce((a, t) => a + t.costUsd, 0);
      addEvent(game, "siwi", "comment", `Simulated ${j.comments.length} demo players' comments`, cost);
      await update(game);
    } catch (e) { setErr(String(e)); }
    setWorking(null);
  }

  async function merge() {
    setWorking("merge"); setErr(null);
    try {
      const j = await post("proposal", { design: latest.design, comments: game.comments.map((c) => ({ name: c.name, body: c.body })), open: true });
      const spec = j.proposal as Proposal;
      const s1Out = game.events.filter((e) => e.season === latest.n && e.kind === "model" && String(e.data?.step).match(/^(code|upgrade_code)$/)).map((e) => (e.data?.usage as { outputTokens: number })?.outputTokens).at(-1);
      const est = await post("estimate", { design: latest.design, proposal: spec, code: latest.code, s1OutputTokens: s1Out });
      const cost = [...j.trace, ...est.trace].reduce((a: number, t: { costUsd: number }) => a + t.costUsd, 0);
      const goal = Math.max(0.05, Math.ceil(est.estimate.totalUsd * 100) / 100);
      const p: ProposalRecord = { season: nextN, spec, estimate: est.estimate, goalUsd: goal, pledges: [], status: "open", openWeights: !!j.openWeights };
      game.proposal = p;
      addEvent(game, j.openWeights ? "open" : "spark", "proposal", `Merged ${game.comments.length} comments into “${spec.title}”. Estimated cost $${est.estimate.totalUsd.toFixed(3)}`, cost);
      await update(game);
    } catch (e) { setErr(String(e)); }
    setWorking(null);
  }

  async function pledge(name: string, amount: number, simulated = false) {
    if (!prop || prop.status !== "open") return;
    prop.pledges.push({ name, amount: round2(amount), t: Date.now(), simulated });
    addEvent(game, "system", "pledge", `${name} pledged $${amount.toFixed(2)}${simulated ? " (demo backer)" : ""}`);
    const total = prop.pledges.reduce((a, p) => a + p.amount, 0);
    if (total + 1e-9 >= prop.goalUsd) {
      prop.status = "building";
      const s = newSeason(nextN, prop.goalUsd);
      s.proposal = prop.spec;
      game.seasons.push(s);
      await update(game);
      startSeason(nextN);
      return;
    }
    await update(game);
  }

  async function fillWithDemoBackers() {
    if (!prop) return;
    let left = prop.goalUsd - prop.pledges.reduce((a, p) => a + p.amount, 0);
    const used = new Set(prop.pledges.map((p) => p.name));
    for (const name of DEMO_BACKERS) {
      if (left <= 0.0001) break;
      if (used.has(name)) continue;
      const amt = Math.max(0.01, Math.min(left, round2(prop.goalUsd / 4)));
      await pledge(name, amt, true);
      left -= amt;
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  if (latest.status !== "ready") return null;
  const pledged = prop ? prop.pledges.reduce((a, p) => a + p.amount, 0) : 0;

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[.03] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-extrabold">Season {nextN}: players decide</h2>
        <span className="mono rounded-full border border-gold/40 px-3 py-1 text-[11px] text-gold">Demo: no real payments</span>
      </div>

      {/* thread */}
      <div className="space-y-2">
        <div className="text-sm font-bold text-white/70">Game thread</div>
        <div className="scroll-thin max-h-72 space-y-2 overflow-y-auto">
          {game.comments.length === 0 && <p className="text-sm text-white/50">No comments yet. What should Season {nextN} add?</p>}
          {game.comments.map((c) => (
            <div key={c.id} className="pop-in rounded-xl bg-white/5 px-3 py-2 text-sm">
              <b>{c.name}</b>{c.simulated && <span className="mono ml-1 text-[10px] text-white/40">simulated player</span>}: {c.body}
            </div>
          ))}
        </div>
        {!prop && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={220} placeholder="I want Season 2 to have…" className="flex-1 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm outline-none focus:border-siwi"
              onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { addComment(me, text.trim()); setText(""); } }} />
            <button className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20" disabled={!text.trim()} onClick={() => { addComment(me, text.trim()); setText(""); }}>Post</button>
            <button className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40" disabled={!!working} onClick={simulatePlayers}>
              {working === "players" ? "Players typing…" : "+ Simulated players"}
            </button>
          </div>
        )}
      </div>

      {!prop && (
        <button disabled={game.comments.length === 0 || !!working || busy} onClick={merge}
          className="flex items-center gap-2 rounded-full bg-siwi px-5 py-2.5 font-extrabold text-navy shadow-[0_0_30px_-6px_#FF6FA5] disabled:opacity-40">
          <Avatar id="spark" size={26} active={working === "merge"} />
          {working === "merge" ? "Spark is merging the thread…" : `Merge thread into a Season ${nextN} proposal`}
        </button>
      )}

      {prop && (
        <div className="pop-in space-y-4">
          <div className="rounded-2xl border border-spark/40 bg-spark/[.07] p-4">
            <div className="mono text-[10px] uppercase tracking-widest text-spark">Season {nextN} proposal · merged by {prop.openWeights ? "Muse Spark Open (open weights)" : "Spark"}</div>
            <h3 className="mt-1 text-xl font-extrabold">{prop.spec.title}</h3>
            <p className="text-white/80">{prop.spec.pitch}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {prop.spec.changes.map((c, i) => (
                <li key={i}>✦ <b>{c.what}</b> <span className="text-white/60">{c.why}</span>{c.requestedBy.length ? <span className="mono text-[11px] text-pixel"> asked by {c.requestedBy.join(", ")}</span> : null}</li>
              ))}
              <li>✦ <b>New level: {prop.spec.newLevel.name}.</b> <span className="text-white/60">{prop.spec.newLevel.idea}</span></li>
            </ul>
            {prop.spec.notIncluded.length > 0 && (
              <div className="mt-3 text-xs text-white/50">Not this season: {prop.spec.notIncluded.map((n) => `${n.idea} (${n.reason})`).join(" · ")}</div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-gold/30 bg-gold/[.05] p-4">
              <div className="text-sm font-bold text-gold">Cost estimate</div>
              <table className="mono mt-2 w-full text-[11px]">
                <tbody>
                  {prop.estimate.lines.map((l) => (
                    <tr key={l.label} className="align-top"><td className="py-0.5 pr-2 text-white/80">{l.label}<div className="text-[10px] text-white/40">{l.detail}</div></td><td className="py-0.5 text-right text-gold">${l.usd.toFixed(4)}</td></tr>
                  ))}
                  <tr className="border-t border-white/10"><td className="pt-1 font-bold">Total</td><td className="pt-1 text-right font-bold text-gold">${prop.estimate.totalUsd.toFixed(3)}</td></tr>
                </tbody>
              </table>
              <div className="mono mt-1 text-[10px] text-white/40">{prop.estimate.method}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold">Split the cost</span>
                <span className="mono text-gold">${pledged.toFixed(2)} / ${prop.goalUsd.toFixed(2)}</span>
              </div>
              <div className="mt-2 h-4 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-gold to-siwi transition-all duration-700" style={{ width: `${Math.min(100, (pledged / prop.goalUsd) * 100)}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {prop.pledges.map((p, i) => <span key={i} className="pop-in mono rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">{p.name} ${p.amount.toFixed(2)}</span>)}
              </div>
              {prop.status === "open" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded-full bg-gold px-4 py-2 text-sm font-extrabold text-navy" onClick={() => pledge(me, Math.min(prop.goalUsd - pledged, round2(prop.goalUsd / 4)) || 0.01)}>
                    Pledge ${Math.max(0.01, Math.min(prop.goalUsd - pledged, round2(prop.goalUsd / 4))).toFixed(2)} as {me}
                  </button>
                  <button className="rounded-full border border-gold/40 px-4 py-2 text-sm text-gold" onClick={fillWithDemoBackers}>Fill with demo backers</button>
                </div>
              ) : (
                <p className="mt-3 text-sm font-bold text-tester">{prop.status === "built" ? `Funded and built. ${prop.pledges.length} backers co-own Season ${nextN}.` : "Funded! The crew is upgrading the game…"}</p>
              )}
              <p className="mt-2 text-[11px] text-white/40">Everyone who pledges becomes a co-owner of Season {nextN}. The crew can only spend what backers pledged.</p>
            </div>
          </div>
        </div>
      )}
      {err && <p className="mono text-xs text-bug">{err}</p>}
    </section>
  );
}
