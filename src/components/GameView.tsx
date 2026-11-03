"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameRecord, Comment } from "@/lib/client/types";
import type { Design } from "@/lib/schemas";
import { loadGame, saveGame } from "@/lib/client/db";
import { runSeason, seasonHtml, isRunning, newSeason, materialsOf, type Live } from "@/lib/client/runner";
import { agent, logTrace, traceCost, useViewer } from "@/lib/client/api";
import { canPlay, money, normalize, owners, roundFor, stageOf, STAGE_LABEL, type Stage } from "@/lib/client/market";
import type { Estimate } from "@/lib/client/types";
import GamePlayer from "./GamePlayer";
import Theater, { PatchView } from "./Theater";
import SeasonTwo from "./SeasonTwo";
import Thread from "./Thread";
import Funding from "./Funding";
import TopBar from "./TopBar";
import { Avatar, CREW } from "./Crew";

const STEPS: { id: Stage | "built"; label: string }[] = [
  { id: "idea", label: "Idea + details" },
  { id: "priced", label: "Priced" },
  { id: "funded", label: "Players buy in" },
  { id: "building", label: "Crew builds" },
  { id: "playable", label: "Buyers play" },
];

export default function GameView({ id }: { id: string }) {
  const me = useViewer();
  const [game, setGame] = useState<GameRecord | null | undefined>(undefined);
  const [live, setLive] = useState<Live | null>(null);
  const [viewSeason, setViewSeason] = useState<number | null>(null);
  const [html, setHtml] = useState<string>("");
  const [showTheater, setShowTheater] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const testRef = useRef<HTMLDivElement>(null);
  const [startLevel, setStartLevel] = useState(0);

  const save = useCallback(async (g: GameRecord) => { setGame({ ...g }); await saveGame(g); }, []);

  const start = useCallback((g: GameRecord, n: number, drill?: "typo") => {
    setShowTheater(true);
    setViewSeason(n);
    setStartLevel(0);
    runSeason(g, n, {
      onChange: (gg, l) => { setGame(gg); setLive(l); },
      testContainer: () => testRef.current,
    }, { drill }).then(() => { setLive(null); setShowTheater(false); });
  }, []);

  useEffect(() => {
    let alive = true;
    loadGame(id).then((raw) => {
      if (!alive) return;
      const g = raw ? normalize(raw) : null;
      setGame(g);
      if (!g || !g.seasons.length) return;
      const last = g.seasons[g.seasons.length - 1];
      setViewSeason(last.status === "ready" ? last.n : g.seasons.find((s) => s.status === "ready")?.n ?? last.n);
      if (last.status === "building" && !isRunning(g.id)) {
        if (last.code) {
          last.status = "ready";
          last.finishedAt = last.finishedAt ?? Date.now();
          g.events.push({ t: Date.now(), season: last.n, agent: "system", kind: "info", msg: "The build was interrupted by a page reload; showing the last version the crew wrote." });
          saveGame(g);
          setGame({ ...g });
        } else if (!g.showcase) start(g, last.n);
      }
    });
    return () => { alive = false; };
  }, [id, start]);

  const season = game?.seasons.find((s) => s.n === viewSeason) ?? null;
  useEffect(() => {
    if (season?.status === "ready" && season.code) seasonHtml(season, startLevel).then(setHtml);
  }, [season?.n, season?.status, season?.code, season, startLevel]);

  if (game === undefined) return <><TopBar /><div className="p-10 text-white/60">Loading…</div></>;
  if (game === null) return <><TopBar /><div className="p-10">Game not found. <Link className="text-siwi underline" href="/">Back to the feed</Link></div></>;

  const stage = stageOf(game);
  const s1 = game.seasons.find((s) => s.n === 1);
  const r1 = roundFor(game, 1);
  const building = game.seasons.some((s) => s.status === "building") || !!live?.active;
  const buildingSeason = game.seasons.find((s) => s.status === "building") ?? game.seasons[game.seasons.length - 1];
  const theaterSeason = building ? buildingSeason : season ?? buildingSeason;
  const ready = game.seasons.filter((s) => s.status === "ready");
  const details = game.comments.filter((c) => (c.season ?? 1) === 1);
  const upvoted = game.upvotes?.includes(me);
  const pictures = (game.images?.length ?? 0) + details.filter((c) => c.image).length;

  async function addDetail(body: string, image?: string) {
    const c: Comment = { id: Math.random().toString(36).slice(2), name: me, body, image, t: Date.now(), season: 1 };
    game!.comments.push(c);
    await save(game!);
  }
  async function simulateDetails() {
    setWorking("players"); setErr(null);
    try {
      const j = await agent<{ comments: { name: string; body: string }[] }>("idea_comments", { idea: game!.idea, thread: details.map((c) => `${c.name}: ${c.body}`) });
      logTrace(game!, 1, j.trace);
      for (const c of j.comments) {
        game!.comments.push({ id: Math.random().toString(36).slice(2), name: c.name, body: c.body, t: Date.now(), simulated: true, season: 1 });
        if (!game!.upvotes!.includes(c.name)) game!.upvotes!.push(c.name);
      }
      await save(game!);
    } catch (e) { setErr(String(e)); }
    setWorking(null);
  }
  async function toggleUpvote() {
    const u = game!.upvotes!;
    game!.upvotes = upvoted ? u.filter((x) => x !== me) : [...u, me];
    await save(game!);
  }
  async function priceIt() {
    setWorking("price"); setErr(null);
    try {
      const d = await agent<{ design: Design }>("design", { idea: game!.idea, by: game!.creator, materials: await materialsOf(game!) });
      const designUsd = traceCost(d.trace);
      const p = await agent<{ estimate: Estimate }>("price", { design: d.design, designUsd });
      const s = s1 ?? newSeason(1, 0);
      s.status = "draft"; s.design = d.design; s.costUsd = designUsd + traceCost(p.trace); s.startedAt = Date.now();
      if (!s1) game!.seasons.push(s);
      game!.events = game!.events.filter((e) => e.season !== 1 || e.kind === "pledge" || e.kind === "comment");
      logTrace(game!, 1, [...d.trace, ...p.trace]);
      game!.events.push({ t: Date.now(), season: 1, agent: "spark", kind: "design", msg: `Design ready: “${d.design.title}” (${d.design.genre}, ${d.design.lighting}). ${d.design.tagline}`, data: { design: d.design } });
      const price = Math.max(0.05, Math.ceil(p.estimate.totalUsd * 100) / 100);
      game!.rounds = [...(game!.rounds ?? []).filter((r) => r.season !== 1), { season: 1, priceUsd: price, estimate: p.estimate, buyers: [], status: "open", pricedAt: Date.now() }];
      game!.events.push({ t: Date.now(), season: 1, agent: "siwi", kind: "info", msg: `Priced at ${money(price)} from Meta's token count of the real build prompt.` });
      game!.title = d.design.title;
      setViewSeason(1);
      await save(game!);
    } catch (e) { setErr(String(e)); }
    setWorking(null);
  }
  async function startBuild(n: number) {
    const s = game!.seasons.find((x) => x.n === n)!;
    const r = roundFor(game!, n)!;
    s.status = "building"; s.budgetUsd = Math.max(r.priceUsd, s.costUsd + 0.05); s.startedAt = Date.now();
    r.status = "building";
    await save(game!);
    start(game!, n);
  }

  const stepIndex = STEPS.findIndex((x) => x.id === (stage === "failed" ? "building" : stage));

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {/* the post */}
        <article className="rounded-3xl border border-white/10 bg-white/[.03] p-5">
          <div className="flex items-start gap-4">
            <button onClick={toggleUpvote} className={`flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2 ${upvoted ? "border-siwi bg-siwi/15 text-siwi" : "border-white/15 text-white/70 hover:border-white/40"}`} aria-label="Upvote">
              <span className="text-lg leading-none">▲</span><span className="mono text-sm font-bold">{game.upvotes?.length ?? 0}</span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="mono text-[11px] text-white/45">idea by <b className="text-white/80">{game.creator}</b>{game.showcase ? " · showcase (recorded run)" : ""}</div>
              <h1 className="text-2xl font-extrabold sm:text-3xl">{season?.design?.title ?? s1?.design?.title ?? game.idea}</h1>
              {(season?.design ?? s1?.design) && <p className="text-white/60">“{game.idea}”</p>}
              {!!game.images?.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {game.images.map((src, i) => <img key={i} src={src} alt={`attached picture ${i + 1}`} className="h-24 rounded-xl border border-white/10" />)}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="mono rounded-full bg-white/10 px-2 py-0.5">{STAGE_LABEL[stage]}</span>
                {r1 && <span className="mono rounded-full bg-gold/15 px-2 py-0.5 text-gold">price {money(r1.priceUsd)} · {r1.buyers.length} buyer{r1.buyers.length === 1 ? "" : "s"}</span>}
                {(s1?.design?.genre) && <span className="mono rounded-full bg-pixel/15 px-2 py-0.5 text-pixel">{s1.design.genre === "topdown" ? "top-down explorer" : "platformer"}{s1.design.lighting === "dark" ? " · lantern dark" : ""}</span>}
              </div>
            </div>
          </div>
          <ol className="mt-4 grid grid-cols-5 gap-1">
            {STEPS.map((st, i) => (
              <li key={st.id} className={`rounded-full px-2 py-1 text-center text-[10px] font-bold sm:text-xs ${i < stepIndex ? "bg-tester/20 text-tester" : i === stepIndex ? "bg-siwi text-navy" : "bg-white/5 text-white/40"}`}>{st.label}</li>
            ))}
          </ol>
        </article>

        {/* before the build: details thread + pricing + buy-in */}
        {(stage === "idea" || stage === "priced" || stage === "funded") && (
          <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
            <section className="space-y-3 rounded-3xl border border-white/10 bg-white/[.03] p-5">
              <h2 className="text-xl font-extrabold">Shape the idea</h2>
              <p className="text-sm text-white/60">Anyone can add details, pictures or drawings. Spark reads all of it when it designs the game, and Pixel uses the pictures as the art reference.</p>
              <Thread comments={details} me={me} onAdd={addDetail} onSimulate={simulateDetails} simulating={working === "players"}
                placeholder="Add a detail: the hero, a place, a mechanic…" empty="No details yet. What would make you buy this game?" />
            </section>
            <aside className="space-y-4">
              {stage === "idea" || (r1 && r1.buyers.length === 0) ? (
                <div className="space-y-3 rounded-2xl border border-spark/40 bg-spark/[.07] p-4">
                  <div className="flex items-center gap-2 font-bold text-spark"><Avatar id="spark" size={28} active={working === "price"} /> {stage === "idea" ? "Price this game" : "Re-price with new details"}</div>
                  <p className="text-sm text-white/70">Spark reads the idea, {details.length} detail{details.length === 1 ? "" : "s"} and {pictures} picture{pictures === 1 ? "" : "s"}, picks a genre and designs it. Siwi then prices the build from Meta&apos;s token count of the real prompt.</p>
                  <button onClick={priceIt} disabled={!!working} className="w-full rounded-full bg-spark px-5 py-2.5 font-extrabold text-white disabled:opacity-50">
                    {working === "price" ? "Spark is designing, Siwi is pricing…" : stage === "idea" ? "Design + price it (~1 min)" : "Re-price"}
                  </button>
                </div>
              ) : null}
              {s1?.design && <DesignCard design={s1.design} />}
              {r1 && s1?.status === "draft" && <Funding game={game} round={r1} me={me} save={save} onStart={() => startBuild(1)} />}
            </aside>
          </div>
        )}

        {/* while building */}
        {(building || showTheater) && theaterSeason && theaterSeason.status !== "draft" && <Theater game={game} season={theaterSeason} live={live} testRef={testRef} />}

        {/* after the build */}
        {!building && !showTheater && ready.length > 0 && season?.status === "ready" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {ready.map((s) => (
                  <button key={s.n} onClick={() => { setViewSeason(s.n); setShowTheater(false); }}
                    className={`rounded-full px-4 py-1.5 text-sm font-bold ${viewSeason === s.n ? "bg-white text-navy" : "border border-white/20 text-white/80"}`}>Season {s.n}{canPlay(game, s.n, me) ? "" : " 🔒"}</button>
                ))}
                <button onClick={() => setShowTheater(true)} className="rounded-full border border-siwi/50 px-4 py-1.5 text-sm font-bold text-siwi">Crew log</button>
              </div>
              {canPlay(game, season.n, me) && html ? (
                <>
                  <GamePlayer html={html} title={season.design?.title ?? "game"} />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="mono flex-1 text-xs text-white/50">{season.design?.genre === "topdown" ? "Arrows / WASD walk · X lantern / action · R restart · click the game first" : "Arrows / WASD move · Space jump · X action · R restart · click the game first"}</p>
                    {season.n > 1 && (season.design?.levels.length ?? 0) > 1 && (
                      <button className="rounded-full border border-pixel/50 px-3 py-1 text-xs font-bold text-pixel hover:bg-pixel/10"
                        onClick={() => setStartLevel(startLevel ? 0 : (season.design?.levels.length ?? 1) - 1)}>
                        {startLevel ? "Play from level 1" : `Play the new level: ${season.design?.levels.at(-1)?.name}`}
                      </button>
                    )}
                    <button title="Break this game on purpose and watch the crew find and fix it" className="rounded-full border border-bug/50 px-3 py-1 text-xs font-bold text-bug hover:bg-bug/10"
                      onClick={() => start(game, season.n, "typo")}>Bug drill</button>
                  </div>
                </>
              ) : (
                <Locked game={game} n={season.n} />
              )}
              {season.knownIssues && season.knownIssues.length > 0 && <p className="text-xs text-bug">Known issues the crew couldn&apos;t fix within budget: {season.knownIssues.join("; ")}</p>}
            </div>
            <aside className="space-y-3">
              {roundFor(game, season.n) && <Funding game={game} round={roundFor(game, season.n)!} me={me} save={save} late />}
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Real cost" value={`$${season.costUsd.toFixed(3)}`} gold />
                <Stat label="Build time" value={season.finishedAt ? `${((season.finishedAt - season.startedAt) / 60000).toFixed(1)} min` : "—"} />
                <Stat label="Playtests" value={String(season.tests)} />
                <Stat label="Bugs fixed" value={String(season.patches.length)} />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
                <div className="text-xs font-bold uppercase tracking-wider text-white/50">Co-owners</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {owners(game).map((o) => <span key={o.name} className="mono rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{o.name} <span className="text-white/40">{o.seasons.map((x) => `S${x}`).join(" ")}</span></span>)}
                </div>
              </div>
              {season.design?.credits && season.design.credits.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3 text-xs">
                  <div className="font-bold uppercase tracking-wider text-white/50">Made from players&apos; ideas</div>
                  <ul className="mt-1 space-y-0.5 text-white/75">{season.design.credits.map((c, i) => <li key={i}><b>{c.name}</b>: {c.used}</li>)}</ul>
                </div>
              )}
              {season.patches.length > 0 && (
                <details className="rounded-2xl border border-white/10 bg-white/[.03] p-3 text-sm">
                  <summary className="cursor-pointer font-bold">Bugs the crew fixed ({season.patches.length})</summary>
                  <div className="mt-2 space-y-4">{season.patches.map((p, i) => <PatchView key={i} patch={p} />)}</div>
                </details>
              )}
            </aside>
          </div>
        )}

        {!building && stage === "failed" && (
          <div className="rounded-2xl border border-bug/40 bg-bug/10 p-4">
            The build failed: {game.events.filter((e) => e.kind === "error").at(-1)?.msg}
            <button className="ml-3 rounded-full bg-white/10 px-3 py-1 text-sm" onClick={async () => {
              const s = game.seasons[game.seasons.length - 1];
              Object.assign(s, { status: "building", startedAt: Date.now() });
              await saveGame(game); start(game, s.n);
            }}>Try again</button>
          </div>
        )}

        {!building && ready.length > 0 && <SeasonTwo game={game} me={me} save={save} startBuild={startBuild} />}
        {err && <p className="mono text-xs text-bug">{err}</p>}

        <footer className="flex flex-wrap gap-3 pt-6 text-[11px] text-white/40">
          {(["siwi", "spark", "pixel", "tester", "fixer"] as const).map((a) => <span key={a} className="flex items-center gap-1"><Avatar id={a} size={16} /> {CREW[a].name}: {CREW[a].model}</span>)}
        </footer>
      </main>
    </>
  );
}

function Locked({ game, n }: { game: GameRecord; n: number }) {
  const s = game.seasons.find((x) => x.n === n);
  const shots = s?.test?.screenshots ?? [];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {(s?.assets.cover || game.cover) && <img src={s?.assets.cover || game.cover} alt="cover" className="aspect-video w-full object-cover opacity-60" />}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-t from-navy-deep via-navy-deep/40 to-transparent p-4 text-center">
        <div className="text-4xl">🔒</div>
        <div className="text-xl font-extrabold">Buyers play this game</div>
        <p className="max-w-md text-sm text-white/70">Buy in on the right. Your share is the price split across everyone who bought, and every later buyer sends some of it back to you as credits.</p>
        {shots.length > 0 && (
          <div className="mt-2 flex gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {shots.slice(0, 3).map((x, i) => <img key={i} src={x} alt={`Tester screenshot ${i + 1}`} className="h-16 rounded-lg border border-white/20" />)}
          </div>
        )}
      </div>
    </div>
  );
}

function DesignCard({ design }: { design: Design }) {
  return (
    <div className="pop-in space-y-2 rounded-2xl border border-white/10 bg-white/[.04] p-4 text-sm">
      <div className="mono text-[10px] uppercase tracking-widest text-spark">Spark&apos;s design · {design.genre === "topdown" ? "top-down explorer" : "platformer"} · {design.lighting}</div>
      <div className="text-lg font-extrabold">{design.title}</div>
      <p className="text-white/75">{design.story}</p>
      <div className="flex gap-1">{Object.values(design.palette).map((c) => <span key={c} className="h-4 w-8 rounded" style={{ background: c }} />)}</div>
      <p><b>{design.hero.name}:</b> <span className="text-white/70">{design.hero.look}</span></p>
      <p><b>{design.specialMechanic.name}:</b> <span className="text-white/70">{design.specialMechanic.howItWorks}</span></p>
      <p className="text-white/60">Levels: {design.levels.map((l) => l.name).join(" · ")}</p>
      {design.credits.length > 0 && <ul className="text-xs text-pixel">{design.credits.map((c, i) => <li key={i}>✦ from {c.name}: {c.used}</li>)}</ul>}
    </div>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/50">{label}</div>
      <div className={`mono text-lg font-bold ${gold ? "text-gold" : ""}`}>{value}</div>
    </div>
  );
}
