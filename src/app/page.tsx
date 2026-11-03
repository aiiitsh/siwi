"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { listLocalGames, listShowcase, loadGame, saveGame } from "@/lib/client/db";
import { newIdea } from "@/lib/client/runner";
import type { GameRecord } from "@/lib/client/types";
import { money, nextShare, normalize, roundFor, stageOf, STAGE_LABEL } from "@/lib/client/market";
import { useViewer } from "@/lib/client/api";
import { Avatar, CREW } from "@/components/Crew";
import TopBar from "@/components/TopBar";
import { readPictures } from "@/components/Thread";

const IDEAS = [
  "a spooky lighthouse where a tiny keeper relights lamps to calm the ghosts",
  "a sleepy cloud who collects raindrops to water a desert garden",
  "a mouse librarian exploring a maze of bookshelves at midnight",
  "a paper crane delivering letters across rooftops at sunset",
];

const HOW: { title: string; sub: string; crew: ("siwi" | "spark" | "pixel" | "tester" | "fixer")[]; badge?: string }[] = [
  { title: "Post an idea", sub: "a sentence, a drawing", crew: ["spark"], badge: "💡" },
  { title: "Siwi prices it", sub: "a few cents, real tokens", crew: ["siwi"], badge: "39¢" },
  { title: "Friends split it", sub: "more buyers, cheaper each", crew: [], badge: "÷" },
  { title: "The crew builds it", sub: "then buyers play", crew: ["pixel", "tester", "fixer"] },
];

export default function Home() {
  const router = useRouter();
  const me = useViewer();
  const [idea, setIdea] = useState("");
  const [pics, setPics] = useState<string[]>([]);
  const [feed, setFeed] = useState<GameRecord[]>([]);
  const [sort, setSort] = useState<"top" | "new">("top");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const local = await listLocalGames().catch(() => [] as GameRecord[]);
      const show = await listShowcase();
      // feed cards for showcase games come from light stubs in index.json; the full game loads on its page
      const showGames = (await Promise.all(show.filter((s) => !local.some((l) => l.id === s.id)).map((s) => s.stub ?? loadGame(s.id)))).filter(Boolean) as GameRecord[];
      setFeed([...local, ...showGames].map(normalize));
    })();
    const refresh = () => listLocalGames().then((local) => setFeed((f) => [...local.map(normalize), ...f.filter((x) => x.showcase && !local.some((l) => l.id === x.id))])).catch(() => {});
    window.addEventListener("siwi:game", refresh);
    return () => window.removeEventListener("siwi:game", refresh);
  }, []);

  async function postIdea() {
    const text = idea.trim();
    if (text.length < 3) return;
    const g = newIdea(text, me, pics);
    await saveGame(g);
    router.push(`/g/${g.id}`);
  }
  async function upvote(card: GameRecord) {
    // showcase cards are light stubs: vote on the full game so the saved local copy stays playable
    const g = card.showcase && !card.seasons.some((s) => s.code) ? normalize((await loadGame(card.id)) ?? card) : card;
    const u = g.upvotes ?? [];
    g.upvotes = u.includes(me) ? u.filter((x) => x !== me) : [...u, me];
    await saveGame(g);
    setFeed((f) => f.map((x) => (x.id === g.id ? { ...g } : x)));
  }

  const sorted = [...feed].sort((a, b) => sort === "new" ? b.createdAt - a.createdAt : (b.upvotes?.length ?? 0) - (a.upvotes?.length ?? 0) || b.createdAt - a.createdAt);

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <section className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
            Post a game idea.<br />
            <span className="bg-gradient-to-r from-siwi via-spark to-pixel bg-clip-text text-transparent">Players split the cost. AI agents build it.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-white/70">
            A crew of AI agents on Meta&apos;s models builds the game for a few cents. Everyone who buys in owns it, and each new buyer makes it cheaper for the ones before.
          </p>
        </section>

        <ol className="mx-auto mt-7 flex max-w-4xl flex-wrap items-stretch justify-center gap-2 sm:flex-nowrap">
          {HOW.map((h, i) => (
            <li key={h.title} className="flex items-center gap-2">
              <div className="flex w-36 flex-col items-center rounded-3xl border border-white/10 bg-white/[.04] px-3 py-4 text-center sm:w-44">
                <div className="flex h-14 items-center justify-center gap-0.5">
                  {h.crew.map((c, k) => <div key={c} className="crew-bob" style={{ animationDelay: `${(i + k) * 0.18}s` }}><Avatar id={c} size={h.crew.length > 1 ? 38 : 50} /></div>)}
                  {h.badge && !h.crew.length && (
                    <div className="flex items-end gap-1">
                      {[34, 26, 20].map((d, k) => <span key={k} className="crew-bob flex items-center justify-center rounded-full bg-gold font-black text-navy shadow-[0_0_14px_-2px_#FFC83D]" style={{ width: d, height: d, fontSize: d * 0.45, animationDelay: `${k * 0.2}s` }}>$</span>)}
                    </div>
                  )}
                  {h.badge && h.crew.length > 0 && <span className="mono -ml-1 self-start rounded-full bg-gold px-1.5 text-[11px] font-bold text-navy">{h.badge}</span>}
                </div>
                <div className="mt-2 text-base font-extrabold leading-tight">{h.title}</div>
                <div className="text-[11px] text-white/55">{h.sub}</div>
              </div>
              {i < HOW.length - 1 && <span className="hidden text-2xl text-white/30 sm:block">→</span>}
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-6 grid max-w-6xl gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            {/* composer */}
            <div className="rounded-3xl border border-white/15 bg-white/[.04] p-3 shadow-2xl">
              <div className="mono px-2 text-[11px] text-white/45">posting as <b className="text-white/80">{me}</b></div>
              <textarea value={idea} onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postIdea(); } }}
                maxLength={300} rows={2} placeholder="What game do you wish existed? e.g. a spooky lighthouse where a tiny keeper relights lamps…"
                className="w-full resize-none bg-transparent px-2 py-2 text-lg outline-none placeholder:text-white/30" />
              {pics.length > 0 && (
                <div className="flex flex-wrap gap-2 px-2 pb-2">
                  {pics.map((p, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt={`picture ${i + 1}`} className="h-16 rounded-lg" />
                      <button onClick={() => setPics(pics.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-bug text-[10px] font-bold" aria-label="Remove">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => { setPics([...pics, ...(await readPictures(e.target.files, 4 - pics.length))].slice(0, 4)); e.target.value = ""; }} />
                <button onClick={() => fileRef.current?.click()} disabled={pics.length >= 4} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10 disabled:opacity-40">+ pictures / drawings</button>
                <div className="flex-1" />
                <button onClick={postIdea} disabled={idea.trim().length < 3} className="rounded-full bg-siwi px-6 py-2.5 font-extrabold text-navy shadow-[0_0_30px_-6px_#FF6FA5] transition hover:scale-[1.03] disabled:opacity-40">Post idea ✦</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {IDEAS.map((x) => <button key={x} onClick={() => setIdea(x)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:border-white/30 hover:text-white">{x}</button>)}
            </div>

            {/* feed */}
            <div className="flex items-center gap-2 pt-2">
              <h2 className="text-xl font-extrabold">Game ideas</h2>
              <div className="flex-1" />
              {(["top", "new"] as const).map((s) => <button key={s} onClick={() => setSort(s)} className={`rounded-full px-3 py-1 text-xs font-bold ${sort === s ? "bg-white text-navy" : "border border-white/15 text-white/70"}`}>{s === "top" ? "Top" : "New"}</button>)}
            </div>
            {sorted.length === 0 && <p className="text-white/50">No ideas yet. Post the first one!</p>}
            {sorted.map((g) => <FeedCard key={g.id} g={g} me={me} onUpvote={() => upvote(g)} />)}
          </div>

          <aside className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
              <div className="text-sm font-extrabold">The crew</div>
              <div className="mt-2 space-y-2">
                {(["siwi", "spark", "pixel", "tester", "fixer"] as const).map((a) => (
                  <div key={a} className="flex items-start gap-2">
                    <Avatar id={a} size={30} />
                    <div><b style={{ color: CREW[a].color }}>{CREW[a].name}</b> <span className="mono text-[10px] text-white/40">{CREW[a].model}</span><div className="text-[11px] leading-snug text-white/60">{BLURB[a]}</div></div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-white/40">Built for the Meta Global AI Developer Hackathon · Build for Your World. Money on this site is simulated demo credit.</p>
          </aside>
        </div>
      </main>
    </>
  );
}

function FeedCard({ g, me, onUpvote }: { g: GameRecord; me: string; onUpvote: () => void }) {
  const stage = stageOf(g);
  const r = roundFor(g, g.seasons.filter((s) => s.status !== "draft").length ? g.seasons[g.seasons.length - 1].n : 1) ?? roundFor(g, 1);
  const thumb = g.cover ?? g.images?.[0];
  const details = g.comments.filter((c) => (c.season ?? 1) === 1).length;
  const up = g.upvotes?.includes(me);
  const readyN = g.seasons.filter((s) => s.status === "ready").length;
  return (
    <article className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-3 transition hover:border-white/25">
      <button onClick={onUpvote} className={`flex h-fit w-12 shrink-0 flex-col items-center rounded-xl border py-1.5 ${up ? "border-siwi bg-siwi/15 text-siwi" : "border-white/15 text-white/70 hover:border-white/40"}`} aria-label="Upvote">
        <span className="leading-none">▲</span><span className="mono text-xs font-bold">{g.upvotes?.length ?? 0}</span>
      </button>
      <Link href={`/g/${g.id}`} className="flex min-w-0 flex-1 gap-3">
        <div className="min-w-0 flex-1">
          <div className="mono text-[11px] text-white/45">{g.creator}{g.showcase ? " · showcase" : ""}</div>
          <div className="font-extrabold">{g.title}</div>
          <div className="line-clamp-2 text-sm text-white/65">“{g.idea}”</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className={`mono rounded-full px-2 py-0.5 ${stage === "playable" ? "bg-tester/20 text-tester" : stage === "building" ? "bg-siwi/20 text-siwi" : "bg-white/10 text-white/70"}`}>{STAGE_LABEL[stage]}{readyN > 1 ? ` · ${readyN} seasons` : ""}</span>
            {r && <span className="mono rounded-full bg-gold/15 px-2 py-0.5 text-gold">{money(r.priceUsd)} · {r.buyers.length} buyer{r.buyers.length === 1 ? "" : "s"} · next share {money(nextShare(r))}</span>}
            <span className="mono rounded-full bg-white/5 px-2 py-0.5 text-white/50">💬 {details}</span>
          </div>
        </div>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="hidden h-24 w-40 shrink-0 rounded-xl object-cover sm:block" />
        )}
      </Link>
    </article>
  );
}

const BLURB = {
  siwi: "Producer: decides every step with tool calls, prices the build, guards the budget.",
  spark: "Designs from players' ideas and pictures, writes game.js, fixes bugs, merges threads.",
  pixel: "Paints the hero from players' pictures, then every sprite in the same style.",
  tester: "Plays each build in a sandbox and judges the screenshots like a player.",
  fixer: "The bigger model, called once when a bug survives a fix.",
} as const;
