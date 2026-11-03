"use client";

import { useState } from "react";
import type { GameRecord, Comment, ProposalRecord, Estimate } from "@/lib/client/types";
import type { Proposal } from "@/lib/schemas";
import { newSeason } from "@/lib/client/runner";
import { agent, logTrace, traceCost } from "@/lib/client/api";
import { money, roundFor } from "@/lib/client/market";
import Thread from "./Thread";
import Funding from "./Funding";
import { Avatar } from "./Crew";

type Props = { game: GameRecord; me: string; save: (g: GameRecord) => Promise<void>; startBuild: (n: number) => void };

/** The sequel loop: thread → Spark merges it into a proposal → Siwi prices it → players buy in → same crew upgrades the game. */
export default function SeasonTwo({ game, me, save, startBuild }: Props) {
  const readySeasons = game.seasons.filter((s) => s.status === "ready");
  const latest = readySeasons[readySeasons.length - 1];
  const draft = game.seasons.find((s) => s.status === "draft" && s.n > 1);
  const nextN = draft?.n ?? latest.n + 1;
  const prop = game.proposal && game.proposal.season === nextN ? game.proposal : null;
  const round = roundFor(game, nextN);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const thread = game.comments.filter((c) => (c.season ?? 1) === nextN);

  async function addComment(body: string, image?: string) {
    const c: Comment = { id: Math.random().toString(36).slice(2), name: me, body, image, t: Date.now(), season: nextN };
    game.comments.push(c);
    await save(game);
  }

  async function simulatePlayers() {
    setWorking("players"); setErr(null);
    try {
      const j = await agent<{ comments: { name: string; body: string }[] }>("community", { design: latest.design });
      for (const c of j.comments) game.comments.push({ id: Math.random().toString(36).slice(2), name: c.name, body: c.body, t: Date.now(), simulated: true, season: nextN });
      logTrace(game, nextN, j.trace);
      await save(game);
    } catch (e) { setErr(String(e)); }
    setWorking(null);
  }

  async function merge() {
    setWorking("merge"); setErr(null);
    try {
      const j = await agent<{ proposal: Proposal; openWeights?: boolean }>("proposal", { design: latest.design, comments: thread.map((c) => ({ name: c.name, body: c.body || "(shared a picture)" })), open: true });
      const s1Out = game.events.filter((e) => e.season === latest.n && e.kind === "model" && String(e.data?.step).match(/^(code|upgrade_code)$/)).map((e) => (e.data?.usage as { outputTokens: number })?.outputTokens).at(-1);
      const est = await agent<{ estimate: Estimate }>("estimate", { design: latest.design, proposal: j.proposal, code: latest.code, s1OutputTokens: s1Out });
      const price = Math.max(0.05, Math.ceil(est.estimate.totalUsd * 100) / 100);
      const p: ProposalRecord = { season: nextN, spec: j.proposal, estimate: est.estimate, goalUsd: price, pledges: [], status: "open", openWeights: !!j.openWeights };
      game.proposal = p;
      const s = newSeason(nextN, price);
      s.status = "draft"; s.proposal = j.proposal; s.costUsd = traceCost([...j.trace, ...est.trace]);
      game.seasons = [...game.seasons.filter((x) => x.n !== nextN), s];
      game.rounds = [...(game.rounds ?? []).filter((r) => r.season !== nextN), { season: nextN, priceUsd: price, estimate: est.estimate, buyers: [], status: "open", pricedAt: Date.now() }];
      logTrace(game, nextN, [...j.trace, ...est.trace]);
      game.events.push({ t: Date.now(), season: nextN, agent: j.openWeights ? "open" : "spark", kind: "proposal", msg: `Merged ${thread.length} comments into “${j.proposal.title}”. Priced at ${money(price)}.` });
      await save(game);
    } catch (e) { setErr(String(e)); }
    setWorking(null);
  }

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[.03] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-extrabold">Season {nextN}: players decide</h2>
        <span className="mono text-[11px] text-white/45">thread → proposal → price → buy in → same crew upgrades this game</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-3">
          <Thread comments={thread} me={me} onAdd={prop ? undefined : addComment} onSimulate={prop ? undefined : simulatePlayers} simulating={working === "players"}
            placeholder={`I want Season ${nextN} to have…`} empty={`No comments yet. What should Season ${nextN} add?`} title="Sequel thread" />
          {!prop && (
            <button disabled={thread.length === 0 || !!working} onClick={merge}
              className="flex items-center gap-2 rounded-full bg-siwi px-5 py-2.5 font-extrabold text-navy shadow-[0_0_30px_-6px_#FF6FA5] disabled:opacity-40">
              <Avatar id="spark" size={26} active={working === "merge"} />
              {working === "merge" ? "Merging the thread and pricing it…" : `Merge thread into a Season ${nextN} proposal + price`}
            </button>
          )}
          {prop && (
            <div className="pop-in rounded-2xl border border-spark/40 bg-spark/[.07] p-4">
              <div className="mono text-[10px] uppercase tracking-widest text-spark">Season {nextN} proposal · merged by {prop.openWeights ? "Muse Spark Open (open weights)" : "Spark"}</div>
              <h3 className="mt-1 text-xl font-extrabold">{prop.spec.title}</h3>
              <p className="text-white/80">{prop.spec.pitch}</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {prop.spec.changes.map((c, i) => (
                  <li key={i}>✦ <b>{c.what}</b> <span className="text-white/60">{c.why}</span>{c.requestedBy.length ? <span className="mono text-[11px] text-pixel"> asked by {c.requestedBy.join(", ")}</span> : null}</li>
                ))}
                <li>✦ <b>New level: {prop.spec.newLevel.name}.</b> <span className="text-white/60">{prop.spec.newLevel.idea}</span></li>
              </ul>
              {prop.spec.notIncluded.length > 0 && <div className="mt-3 text-xs text-white/50">Not this season: {prop.spec.notIncluded.map((n) => `${n.idea} (${n.reason})`).join(" · ")}</div>}
            </div>
          )}
        </div>
        <div>
          {round && draft && <Funding game={game} round={round} me={me} save={save} onStart={() => startBuild(nextN)} />}
          {!round && <p className="rounded-2xl border border-dashed border-white/15 p-4 text-sm text-white/50">Once the thread is merged, Siwi prices Season {nextN} here and players buy in. Every buyer splits the price and plays the new season.</p>}
        </div>
      </div>
      {err && <p className="mono text-xs text-bug">{err}</p>}
    </section>
  );
}
