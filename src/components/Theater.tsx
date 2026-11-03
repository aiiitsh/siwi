"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GameRecord, SeasonRecord, AgentId, GameEvent } from "@/lib/client/types";
import type { Live } from "@/lib/client/runner";
import { CrewCard, Avatar, CREW } from "./Crew";
import { lineDiff } from "@/lib/client/diff";

const ORDER: AgentId[] = ["siwi", "spark", "pixel", "tester", "fixer"];

export default function Theater({ game, season, live, testRef }: { game: GameRecord; season: SeasonRecord; live: Live | null; testRef: React.RefObject<HTMLDivElement | null> }) {
  const events = game.events.filter((e) => e.season === season.n);
  const lastSay = useMemo(() => {
    const m: Partial<Record<AgentId, string>> = {};
    for (const e of events) if (e.kind === "say") m[e.agent] = e.msg;
    return m;
  }, [events]);
  const bugs = events.filter((e) => e.kind === "bug").slice(-6);
  const lastPatch = season.patches[season.patches.length - 1];
  const show: "test" | "patch" | "bugs" | "code" | "art" | "design" =
    live?.testing ? "test"
    : live?.active === "spark" && season.patches.length && lastPatch ? "patch"
    : live?.active === "fixer" || (live?.active === "tester" && season.tests > 0) ? "bugs"
    : events.at(-1)?.kind === "patch" ? "patch"
    : ["bug", "say"].includes(events.at(-1)?.kind ?? "") && bugs.length && !season.test?.pass && live?.active !== "pixel" && live?.active !== "spark" ? "bugs"
    : live?.active === "spark" && season.code ? "code"
    : Object.keys(season.assets).length || live?.active === "pixel" ? "art"
    : "design";
  const pct = Math.min(100, (season.costUsd / Math.max(0.01, season.budgetUsd)) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {ORDER.map((id) => (
          <CrewCard key={id} id={id} active={live?.active === id} speech={lastSay[id]} sub={live?.active === id ? live.activity : undefined} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-4">
          {/* The Tester's sandbox renders here, visibly, while it plays. */}
          <div ref={testRef} className={show === "test" ? "block" : "hidden"} />
          {show === "test" && <p className="mono mt-2 text-xs text-tester">Tester is playing with scripted input: run, jump, act. Watching for errors, blank frames, stuck player…</p>}
          {show === "art" && <ArtBoard season={season} live={live} />}
          {show === "code" && <CodeView code={season.code!} />}
          {show === "bugs" && <BugBoard events={bugs} shots={season.test?.screenshots ?? []} />}
          {show === "patch" && lastPatch && <PatchView patch={lastPatch} />}
          {show === "design" && <DesignView season={season} />}
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded-2xl border border-gold/30 bg-gold/[.06] p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gold">Spent</span>
              <span className="mono text-xl font-bold text-gold">${season.costUsd.toFixed(3)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="mono mt-1 text-[10px] text-white/50">budget cap ${season.budgetUsd.toFixed(2)} · max 3 patch loops · 1 Wonder escalation</div>
          </div>
          <Log events={events} />
        </div>
      </div>
    </div>
  );
}

function Log({ events }: { events: GameEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [events.length]);
  return (
    <div ref={ref} className="scroll-thin mono h-[300px] overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed lg:h-[340px]">
      {events.map((e, i) => (
        <div key={i} className="pop-in flex gap-2">
          <span className="shrink-0 font-bold" style={{ color: e.kind === "bug" || e.kind === "error" ? "#FF5A6E" : CREW[e.agent]?.color }}>{CREW[e.agent]?.name ?? e.agent}</span>
          <span className={e.kind === "model" ? "text-white/40" : e.kind === "decision" ? "text-siwi" : e.kind === "bug" || e.kind === "error" ? "text-bug" : e.kind === "accept" ? "text-tester" : "text-white/80"}>
            {e.kind === "decision" ? `→ ${e.msg}` : e.msg}
            {e.costUsd ? <span className="text-gold"> +${e.costUsd.toFixed(4)}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function ArtBoard({ season, live }: { season: SeasonRecord; live: Live | null }) {
  const names = Object.keys(season.assets).filter((n) => n !== "background" && n !== "cover");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-pixel"><Avatar id="pixel" size={24} active={live?.active === "pixel"} /> Pixel&apos;s board {live?.artTotal ? <span className="mono text-xs text-white/50">{live.artDone.length}/{live.artTotal}</span> : null}</div>
      {season.assets.background && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={season.assets.background} alt="background" className="pop-in aspect-[16/9] w-full rounded-xl object-cover" />
      )}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {names.map((n) => (
          <figure key={n} className="pop-in checker flex flex-col items-center rounded-xl p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={season.assets[n]} alt={n} className="h-16 w-16 object-contain" />
            <figcaption className="mono mt-1 text-[10px] text-white/60">{n}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function CodeView({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <div>
      <div className="mb-2 text-sm font-bold text-spark">game.js · {lines.length} lines on siwi-kit</div>
      <pre className="scroll-thin mono max-h-[420px] overflow-auto rounded-xl bg-black/50 p-3 text-[11px] leading-snug text-white/80">
        {lines.slice(0, 120).map((l, i) => <div key={i}><span className="mr-3 inline-block w-7 text-right text-white/25">{i + 1}</span>{l.slice(0, 140)}</div>)}
      </pre>
    </div>
  );
}

function BugBoard({ events, shots }: { events: GameEvent[]; shots: string[] }) {
  return (
    <div className="space-y-3">
      <div className={`text-sm font-bold ${events.length ? "text-bug" : "text-tester"}`}>{events.length ? "Tester found bugs" : "Tester's screenshots"}</div>
      {events.map((e, i) => {
        const b = (e.data?.bug ?? {}) as { title?: string; evidence?: string; severity?: string };
        return (
          <div key={i} className="pop-in rounded-xl border border-bug/40 bg-bug/10 p-3">
            <div className="font-bold text-bug">{b.title ?? e.msg} <span className="mono text-[10px] uppercase text-white/50">{b.severity}</span></div>
            {b.evidence && <div className="mono mt-1 text-[11px] text-white/70">{b.evidence}</div>}
          </div>
        );
      })}
      {shots.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shots.map((s, i) => <img key={i} src={s} alt={`screenshot ${i + 1}`} className="rounded-lg border border-white/10" />)}
        </div>
      )}
    </div>
  );
}

export function PatchView({ patch }: { patch: SeasonRecord["patches"][number] }) {
  const hunks = useMemo(() => lineDiff(patch.before, patch.after), [patch]);
  const who = patch.by === "fixer" ? "fixer" : "spark";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-bold" style={{ color: CREW[who].color }}>
        <Avatar id={who} size={24} /> {CREW[who].name}&apos;s fix <span className="mono text-[10px] text-white/50">{patch.model}</span>
      </div>
      <p className="text-sm text-white/85">{patch.diagnosis}</p>
      <div className="scroll-thin mono max-h-[360px] overflow-auto rounded-xl bg-black/50 p-2 text-[11px] leading-snug">
        {hunks.slice(0, 8).map((h, k) => (
          <div key={k} className="mb-2 border-b border-white/5 pb-2">
            {h.map((d, i) => (
              <div key={i} className={d.kind === "add" ? "bg-tester/10 text-tester" : d.kind === "del" ? "bg-bug/10 text-bug line-through decoration-bug/40" : "text-white/40"}>
                <span className="mr-2 inline-block w-3">{d.kind === "add" ? "+" : d.kind === "del" ? "−" : " "}</span>{d.text.slice(0, 160)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DesignView({ season }: { season: SeasonRecord }) {
  const d = season.design;
  if (!d) return <div className="flex h-full min-h-[300px] items-center justify-center gap-3 text-white/60"><Avatar id="spark" active size={40} /> Spark is reading the idea<span className="crew-dots" /></div>;
  return (
    <div className="space-y-3">
      <div className="text-sm font-bold text-spark">Design doc</div>
      <h3 className="text-2xl font-extrabold">{d.title}</h3>
      <p className="text-white/80">{d.story}</p>
      <div className="flex gap-1">{Object.values(d.palette).map((c) => <span key={c} className="h-6 w-10 rounded" style={{ background: c }} />)}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-white/5 p-3 text-sm"><b>Hero:</b> {d.hero.name}. {d.hero.look}</div>
        <div className="rounded-xl bg-white/5 p-3 text-sm"><b>{d.specialMechanic.name}:</b> {d.specialMechanic.howItWorks}</div>
        {d.levels.map((l) => <div key={l.name} className="rounded-xl bg-white/5 p-3 text-sm"><b>{l.name}:</b> {l.idea}</div>)}
      </div>
    </div>
  );
}
