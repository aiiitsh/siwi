"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { listLocalGames, listShowcase, saveGame, playerName, setPlayerName, type ShowcaseEntry } from "@/lib/client/db";
import { newGame } from "@/lib/client/runner";
import type { GameRecord } from "@/lib/client/types";
import { Avatar, CREW } from "@/components/Crew";

const IDEAS = [
  "a sleepy cloud who collects raindrops to water a desert garden",
  "a tiny lantern fish exploring a glowing reef, flipping gravity to swim on the ceiling",
  "a paper crane delivering letters across rooftops at sunset",
  "a hedge-trimmer robot who collects seeds to replant a park",
];

export default function Home() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [name, setName] = useState("You");
  const [mine, setMine] = useState<GameRecord[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseEntry[]>([]);

  useEffect(() => {
    setName(playerName());
    listLocalGames().then(setMine).catch(() => {});
    listShowcase().then(setShowcase);
  }, []);

  async function build() {
    const text = idea.trim();
    if (text.length < 3) return;
    setPlayerName(name.trim() || "You");
    const g = newGame(text, name.trim() || "You");
    await saveGame(g);
    router.push(`/g/${g.id}`);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10">
      <section className="mx-auto max-w-3xl text-center">
        <div className="mb-6 flex justify-center gap-1">
          {(["siwi", "spark", "pixel", "tester", "fixer"] as const).map((a, i) => (
            <div key={a} style={{ animationDelay: `${i * 0.15}s` }} className="crew-bob"><Avatar id={a} size={52} /></div>
          ))}
        </div>
        <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
          Type one sentence.<br />
          <span className="bg-gradient-to-r from-siwi via-spark to-pixel bg-clip-text text-transparent">A crew of AI agents builds the game.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-white/70">
          Players who chip in co-own it. When they want a sequel, they talk it out, split the cost, and the same crew upgrades the game into Season 2.
        </p>

        <div className="mt-8 rounded-3xl border border-white/15 bg-white/[.04] p-3 text-left shadow-2xl">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); build(); } }}
            maxLength={300}
            rows={2}
            placeholder="a sleepy cloud who collects raindrops to water a desert garden"
            className="w-full resize-none bg-transparent px-3 py-2 text-lg outline-none placeholder:text-white/30"
          />
          <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
            <label className="mono flex items-center gap-2 text-xs text-white/50">
              your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} className="w-28 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-white outline-none" />
            </label>
            <div className="flex-1" />
            <button onClick={build} disabled={idea.trim().length < 3} className="rounded-full bg-siwi px-6 py-2.5 font-extrabold text-navy shadow-[0_0_30px_-6px_#FF6FA5] transition hover:scale-[1.03] disabled:opacity-40">
              Build it ✦
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {IDEAS.map((x) => (
            <button key={x} onClick={() => setIdea(x)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:border-white/30 hover:text-white">{x}</button>
          ))}
        </div>
        <p className="mono mt-4 text-[11px] text-white/40">A game costs a few cents and takes about 3 to 5 minutes. Gentle, original games only.</p>
      </section>

      {mine.length > 0 && <Gallery title="Your games" items={mine.map((g) => ({ id: g.id, title: g.title, idea: g.idea, cover: g.cover, seasons: g.seasons.filter((s) => s.status === "ready").length, costUsd: g.seasons.reduce((a, s) => a + s.costUsd, 0) }))} />}
      {showcase.length > 0 && <Gallery title="Built by the crew" note="Real recorded builds that ship with the site" items={showcase} />}

      <section className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(["siwi", "spark", "pixel", "tester", "fixer"] as const).map((a) => (
          <div key={a} className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
            <div className="flex items-center gap-2"><Avatar id={a} size={36} /><b style={{ color: CREW[a].color }}>{CREW[a].name}</b></div>
            <p className="mt-2 text-sm text-white/70">{BLURB[a]}</p>
            <p className="mono mt-2 text-[10px] text-white/40">{CREW[a].model}</p>
          </div>
        ))}
      </section>
      <p className="mt-8 text-center text-xs text-white/40">
        Built for the Meta Global AI Developer Hackathon · Build for Your World · <Link className="underline" href="/examples/meadow-hop">hand-made kit example</Link>
      </p>
    </main>
  );
}

const BLURB = {
  siwi: "Producer. Decides every next step with tool calls, watches the budget, and knows when to ship.",
  spark: "Designs the game, writes game.js on our engine kit, fixes bugs, merges player threads into proposals.",
  pixel: "Paints the hero first, then every sprite with the hero as a reference, so it all looks like one world.",
  tester: "Plays every build in a sandbox, checks errors and frames, then looks at screenshots like a player.",
  fixer: "The bigger model. Called in once, only when the same bug survives a fix.",
} as const;

function Gallery({ title, note, items }: { title: string; note?: string; items: ShowcaseEntry[] }) {
  return (
    <section className="mt-14">
      <div className="mb-3 flex items-baseline gap-3"><h2 className="text-2xl font-extrabold">{title}</h2>{note && <span className="text-xs text-white/40">{note}</span>}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((g) => (
          <Link key={g.id} href={`/g/${g.id}`} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[.03] transition hover:-translate-y-0.5 hover:border-white/30">
            <div className="aspect-video bg-black/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {g.cover ? <img src={g.cover} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-white/30">building…</div>}
            </div>
            <div className="p-3">
              <div className="font-extrabold">{g.title}</div>
              <div className="line-clamp-1 text-xs text-white/50">“{g.idea}”</div>
              <div className="mono mt-1 text-[11px] text-white/50">{g.seasons} season{g.seasons === 1 ? "" : "s"} · <span className="text-gold">${g.costUsd.toFixed(2)}</span></div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
