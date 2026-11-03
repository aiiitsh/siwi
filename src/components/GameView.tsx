"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameRecord } from "@/lib/client/types";
import { loadGame, saveGame } from "@/lib/client/db";
import { runSeason, seasonHtml, isRunning, type Live } from "@/lib/client/runner";
import GamePlayer from "./GamePlayer";
import Theater, { PatchView } from "./Theater";
import SeasonTwo from "./SeasonTwo";
import { Avatar, CREW } from "./Crew";

export default function GameView({ id }: { id: string }) {
  const [game, setGame] = useState<GameRecord | null | undefined>(undefined);
  const [live, setLive] = useState<Live | null>(null);
  const [viewSeason, setViewSeason] = useState<number | null>(null);
  const [html, setHtml] = useState<string>("");
  const [showTheater, setShowTheater] = useState(false);
  const testRef = useRef<HTMLDivElement>(null);

  const start = useCallback((g: GameRecord, n: number) => {
    setShowTheater(true);
    setViewSeason(n);
    runSeason(g, n, {
      onChange: (gg, l) => { setGame(gg); setLive(l); },
      testContainer: () => testRef.current,
    }).then(() => setLive(null));
  }, []);

  useEffect(() => {
    let alive = true;
    loadGame(id).then((g) => {
      if (!alive) return;
      setGame(g);
      if (!g) return;
      const last = g.seasons[g.seasons.length - 1];
      setViewSeason(last.status === "ready" ? last.n : g.seasons.find((s) => s.status === "ready")?.n ?? last.n);
      // A season still marked "building" with nothing running means a fresh game (or an interrupted run): (re)start it.
      if (last.status === "building" && !isRunning(g.id)) {
        if (last.n === 1 && !last.code && !g.showcase) start(g, 1);
        else if (last.n > 1) start(g, last.n);
      }
    });
    return () => { alive = false; };
  }, [id, start]);

  const season = game?.seasons.find((s) => s.n === viewSeason) ?? null;
  useEffect(() => {
    if (season?.status === "ready" && season.code) seasonHtml(season).then(setHtml);
  }, [season?.n, season?.status, season?.code, season]);

  if (game === undefined) return <div className="p-10 text-white/60">Loading…</div>;
  if (game === null) return <div className="p-10">Game not found. <Link className="text-siwi underline" href="/">Back home</Link></div>;

  const building = game.seasons.some((s) => s.status === "building") || !!live?.active;
  const buildingSeason = game.seasons.find((s) => s.status === "building") ?? game.seasons[game.seasons.length - 1];
  const theaterSeason = building ? buildingSeason : season ?? buildingSeason;
  const ready = game.seasons.filter((s) => s.status === "ready");

  const setGameAndSave = (g: GameRecord) => setGame({ ...g });

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="mono text-xs text-white/50 hover:text-white">← Siwi</Link>
          <h1 className="text-3xl font-extrabold sm:text-4xl">{season?.design?.title ?? game.title}</h1>
          <p className="text-sm text-white/60">“{game.idea}” · idea by {game.creator}{game.showcase ? " · showcase build (recorded run)" : ""}</p>
        </div>
        <div className="flex gap-2">
          {ready.map((s) => (
            <button key={s.n} onClick={() => { setViewSeason(s.n); setShowTheater(false); }}
              className={`rounded-full px-4 py-1.5 text-sm font-bold ${viewSeason === s.n && !showTheater ? "bg-white text-navy" : "border border-white/20 text-white/80"}`}>Season {s.n}</button>
          ))}
          <button onClick={() => setShowTheater((x) => !x)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${showTheater || building ? "bg-siwi text-navy" : "border border-siwi/50 text-siwi"}`}>
            {building ? "Crew at work" : "Crew log"}
          </button>
        </div>
      </header>

      {(building || showTheater) && theaterSeason && <Theater game={game} season={theaterSeason} live={live} testRef={testRef} />}

      {!building && !showTheater && season?.status === "ready" && html && (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-2">
            <GamePlayer html={html} title={season.design?.title ?? "game"} />
            <p className="mono text-xs text-white/50">Arrows / WASD move · Space jump · X action · R restart · click the game first</p>
            {season.knownIssues && season.knownIssues.length > 0 && <p className="text-xs text-bug">Known issues the crew couldn&apos;t fix within budget: {season.knownIssues.join("; ")}</p>}
          </div>
          <aside className="space-y-3">
            <Stat label={`Season ${season.n} cost`} value={`$${season.costUsd.toFixed(3)}`} gold />
            <Stat label="Build time" value={season.finishedAt ? `${((season.finishedAt - season.startedAt) / 60000).toFixed(1)} min` : "—"} />
            <Stat label="Playtests / fixes" value={`${season.tests} / ${season.patches.length}`} />
            <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-white/50">Owners</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {game.owners.map((o, i) => <span key={i} className="mono rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{o.name} <span className="text-white/40">S{o.season}</span></span>)}
              </div>
            </div>
            {season.patches.length > 0 && (
              <details className="rounded-2xl border border-white/10 bg-white/[.03] p-3 text-sm">
                <summary className="cursor-pointer font-bold">Bugs the crew fixed ({season.patches.length})</summary>
                <div className="mt-2 space-y-4">{season.patches.map((p, i) => <PatchView key={i} patch={p} />)}</div>
              </details>
            )}
          </aside>
        </div>
      )}

      {!building && game.seasons[game.seasons.length - 1].status === "failed" && (
        <div className="rounded-2xl border border-bug/40 bg-bug/10 p-4">
          The build failed: {game.events.filter((e) => e.kind === "error").at(-1)?.msg}
          <button className="ml-3 rounded-full bg-white/10 px-3 py-1 text-sm" onClick={async () => {
            const s = game.seasons[game.seasons.length - 1];
            Object.assign(s, { status: "building", startedAt: Date.now(), costUsd: s.costUsd });
            await saveGame(game); start(game, s.n);
          }}>Try again</button>
        </div>
      )}

      {!building && ready.length > 0 && (
        <SeasonTwo game={game} setGame={setGameAndSave} busy={building} startSeason={(n) => start(game, n)} />
      )}

      <footer className="flex flex-wrap gap-3 pt-6 text-[11px] text-white/40">
        {(["siwi", "spark", "pixel", "tester", "fixer"] as const).map((a) => <span key={a} className="flex items-center gap-1"><Avatar id={a} size={16} /> {CREW[a].name}: {CREW[a].model}</span>)}
      </footer>
    </main>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-white/50">{label}</div>
      <div className={`mono text-xl font-bold ${gold ? "text-gold" : ""}`}>{value}</div>
    </div>
  );
}
