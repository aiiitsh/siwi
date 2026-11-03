"use client";
import { assembleGameHtml } from "@/lib/html";
import { playtest, scriptFor, type TestReport } from "@/lib/playtester";
import { CAPS, type BuildStatus, type ToolName } from "@/lib/pipeline";
import type { Design, Verdict, Bug, Proposal } from "@/lib/schemas";
import { saveGame } from "./db";
import type { GameRecord, SeasonRecord, GameEvent, AgentId, Trace } from "./types";

/* ------------------------------------------------------------------ kit + html */
let kitP: Promise<[string, string]> | null = null;
export function loadKit(): Promise<[string, string]> {
  if (!kitP) kitP = Promise.all([fetch("/siwi-kit.js").then((r) => r.text()), fetch("/siwi-harness.js").then((r) => r.text())]);
  return kitP;
}
export async function seasonHtml(s: SeasonRecord, startLevel = 0): Promise<string> {
  const [kit, harness] = await loadKit();
  return assembleGameHtml({ kit, harness, title: s.design?.title ?? "Siwi game", gameJs: s.code ?? "", assets: s.assets, startLevel });
}

/* ------------------------------------------------------------------ api */
type ApiOut = Record<string, unknown> & { ok: boolean; error?: string; trace: Trace[] };
async function api(step: string, body: unknown): Promise<ApiOut> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`/api/agent/${step}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as ApiOut;
      if (j.ok) return j;
      lastErr = j.error ?? `HTTP ${r.status}`;
      if (r.status < 500) break;
    } catch (e) {
      lastErr = String(e);
    }
  }
  throw new Error(`${step} failed: ${lastErr}`);
}

/* ------------------------------------------------------------------ live view state (not persisted) */
export type Live = {
  active: AgentId | null;
  activity: string;
  speech: Partial<Record<AgentId, string>>;
  artDone: string[];
  artTotal: number;
  testing: boolean;
  phase: string;
};

export type RunnerHooks = {
  onChange: (g: GameRecord, live: Live) => void;
  /** Where the Tester's sandbox should render (visible on screen during the playtest). */
  testContainer: () => HTMLElement | null;
};

const running = new Set<string>();
export function isRunning(id: string) { return running.has(id); }

/* ------------------------------------------------------------------ runner */
/** A deliberate, clearly labeled break used by "Bug drill" to show Tester + Spark catching and fixing a bug. */
export const DRILLS = [
  { id: "typo", label: "a typo in the engine call (game crashes on load)", apply: (c: string) => c.replace("Siwi.platformer(", "Siwi.platfromer(").replace("Siwi.topdown(", "Siwi.topdwon(") },
] as const;

export async function runSeason(game: GameRecord, n: number, hooks: RunnerHooks, opts: { drill?: (typeof DRILLS)[number]["id"] } = {}): Promise<void> {
  if (running.has(game.id)) return;
  running.add(game.id);
  const live: Live = { active: null, activity: "", speech: {}, artDone: [], artTotal: 0, testing: false, phase: "start" };
  const season = game.seasons.find((s) => s.n === n)!;
  let saveQ = Promise.resolve();
  const touch = () => {
    hooks.onChange({ ...game }, { ...live, speech: { ...live.speech } });
    saveQ = saveQ.then(() => saveGame(game)).catch(() => {});
  };
  const emit = (e: Omit<GameEvent, "t" | "season">) => {
    game.events.push({ ...e, t: Date.now(), season: n });
    if (e.kind === "say") live.speech[e.agent] = e.msg;
    touch();
  };
  const work = (agent: AgentId | null, activity: string) => { live.active = agent; live.activity = activity; touch(); };
  const addTrace = (trace: Trace[]) => {
    for (const t of trace) {
      season.costUsd += t.costUsd;
      emit({ agent: t.agent, kind: "model", msg: `${t.step} · ${t.model} · ${fmtTokens(t)} · ${(t.latencyMs / 1000).toFixed(1)}s`, costUsd: t.costUsd, data: { ...t } });
    }
  };

  const prev = n > 1 ? game.seasons.find((s) => s.n === n - 1) ?? null : null;
  const proposal: Proposal | undefined = season.proposal;
  const status: BuildStatus = {
    season: n, art: "none", code: "none", lastTest: null, previousBugIds: [], patchLoops: 0,
    maxPatchLoops: CAPS.patchLoops, wonderUsed: false, spentUsd: 0, budgetUsd: season.budgetUsd,
  };
  let lastBugs: Bug[] = [];
  let artPromise: Promise<void> | null = null;
  let imagesUsed = 0;
  const runStart = Date.now();

  try {
    /* ---- design */
    if (opts.drill) {
      const drill = DRILLS.find((d) => d.id === opts.drill)!;
      const broken = drill.apply(season.code ?? "");
      if (broken === season.code) throw new Error("bug drill could not break this game");
      season.code = broken;
      season.status = "building";
      season.budgetUsd = season.costUsd + 0.5; // a drill gets its own fixing budget
      status.budgetUsd = season.budgetUsd;
      status.code = "untested";
      status.art = "done";
      emit({ agent: "system", kind: "info", msg: `Bug drill: we broke the game on purpose (${drill.label}). Can the crew find and fix it?` });
      emit({ agent: "siwi", kind: "say", msg: "Somebody broke the build! Tester, find out what happened." });
    } else if (n === 1 && season.design) {
      const buyers = game.rounds?.find((r) => r.season === 1)?.buyers.length ?? 0;
      emit({ agent: "siwi", kind: "say", msg: `${buyers} buyer${buyers === 1 ? "" : "s"} funded ${game.creator}'s idea! Spark's design is ready, let's build it.` });
    } else if (n === 1) {
      emit({ agent: "siwi", kind: "say", msg: `New idea from ${game.creator}! Spark, can you design it?` });
      work("spark", "Designing the game");
      const r = await api("design", { idea: game.idea, by: game.creator, materials: await materialsOf(game) });
      addTrace(r.trace);
      season.design = r.design as Design;
      game.title = season.design.title;
      emit({ agent: "spark", kind: "design", msg: `Design ready: “${season.design.title}”. ${season.design.tagline}`, data: { design: season.design } });
      emit({ agent: "spark", kind: "say", msg: `${season.design.hero.name} in ${season.design.world.setting.split(",")[0]}. Special move: ${season.design.specialMechanic.name}!` });
    } else if (prev && proposal) {
      // Season 2 keeps the same world and adds the funded changes.
      season.design = {
        ...prev.design!,
        title: proposal.title.toLowerCase().includes("season") ? proposal.title.slice(0, 40) : `${prev.design!.title}: Season ${n}`.slice(0, 40),
        levels: [...prev.design!.levels, proposal.newLevel].slice(0, 3),
        sprites: [...prev.design!.sprites, ...proposal.newSprites.map((s) => ({ ...s }))].slice(0, 12),
      };
      season.assets = { ...prev.assets };
      season.refs = { ...prev.refs };
      emit({ agent: "siwi", kind: "say", msg: `Season ${n} is funded by ${game.rounds?.find((r) => r.season === n)?.buyers.length ?? 0} buyers! Same crew, same world. Let's upgrade it.` });
    }
    status.spentUsd = season.costUsd;
    touch();

    /* ---- Siwi's loop */
    for (let step = 0; step < 16; step++) {
      status.spentUsd = season.costUsd;
      work("siwi", "Deciding what's next");
      const d = await api("decide", { status });
      addTrace(d.trace);
      const tool = d.tool as ToolName;
      const say = String(d.say || defaultSay(tool));
      emit({ agent: "siwi", kind: "decision", msg: `${tool}${d.by === "rule" ? " (rule fallback)" : ""}`, data: { tool, allowed: d.allowed, by: d.by, status: { ...status } } });
      emit({ agent: "siwi", kind: "say", msg: say });

      if (tool === "generate_art") {
        status.art = "running";
        artPromise = runArt().then(() => { status.art = "done"; }, (e) => { status.art = "failed"; emit({ agent: "pixel", kind: "error", msg: `Art failed: ${String(e).slice(0, 160)}` }); });
        continue;
      }
      if (tool === "write_code") {
        work("spark", n === 1 ? "Writing game.js on the Siwi kit" : `Upgrading game.js to Season ${n}`);
        emit({ agent: "spark", kind: "say", msg: n === 1 ? "Writing the levels and the special move on our engine kit. This is the long part!" : "Opening last season's game.js and adding what the players funded." });
        const r = n === 1
          ? await api("code", { design: season.design })
          : await api("upgrade", { design: prev!.design, proposal, code: prev!.code });
        addTrace(r.trace);
        season.code = String(r.code);
        season.notes = String(r.notes ?? "");
        status.code = "untested";
        emit({ agent: "spark", kind: "code", msg: `game.js written: ${season.code.split("\n").length} lines. ${season.notes}`, data: { lint: r.lint } });
        continue;
      }
      if (tool === "run_playtest") {
        if (artPromise && status.art === "running") { work("pixel", "Finishing the art before the playtest"); await artPromise; }
        await runTest();
        continue;
      }
      if (tool === "patch_code" || tool === "escalate_to_wonder") {
        const wonder = tool === "escalate_to_wonder";
        const who: AgentId = wonder ? "fixer" : "spark";
        work(who, wonder ? "Muse Wonder is studying the bug" : "Fixing the bugs");
        emit({ agent: who, kind: "say", msg: wonder ? "Let me take a deeper look at this one." : `On it: ${lastBugs.filter((b) => b.severity !== "minor").map((b) => b.title).slice(0, 2).join("; ")}` });
        const before = season.code!;
        const r = await api("patch", { code: before, bugs: lastBugs.filter((b) => b.severity !== "minor").slice(0, 6), wonder });
        addTrace(r.trace);
        season.code = String(r.code);
        season.patches.push({ by: wonder ? "fixer" : "spark", model: String(r.model), diagnosis: String(r.diagnosis), before, after: season.code, bugIds: lastBugs.map((b) => b.id) });
        status.patchLoops++;
        if (wonder) status.wonderUsed = true;
        status.code = "untested";
        emit({ agent: who, kind: "patch", msg: String(r.diagnosis), data: { edits: r.edits, model: r.model, index: season.patches.length - 1 } });
        continue;
      }
      if (tool === "accept_build") {
        if (artPromise) { work("pixel", "Finishing the art"); await artPromise; }
        break;
      }
    }

    if (!season.code) throw new Error("no code was written");
    season.status = "ready";
    season.finishedAt = Date.now();
    const pass = !!season.test?.pass;
    season.knownIssues = pass ? [] : (season.test?.verdict?.bugs ?? []).filter((b) => b.severity !== "minor").map((b) => b.title);
    const round = game.rounds?.find((r) => r.season === n);
    if (round && !opts.drill) round.status = "built";
    if (n > 1 && game.proposal && !opts.drill) game.proposal.status = "built";
    if (season.assets.cover) game.cover = season.assets.cover;
    const mins = ((season.finishedAt - runStart) / 60000).toFixed(1);
    emit({ agent: "siwi", kind: "accept", msg: `${opts.drill ? "Fixed and re-shipped" : "Shipped"} Season ${n} in ${mins} min for $${season.costUsd.toFixed(3)}${pass ? "." : `, with known issues: ${season.knownIssues.join("; ")}`}` });
    emit({ agent: "siwi", kind: "say", msg: pass ? "It's live! Go play it." : "It's live, with a note about what's still rough." });
    work(null, "");
  } catch (e) {
    season.status = season.code ? "ready" : "failed";
    season.finishedAt = Date.now();
    emit({ agent: "system", kind: "error", msg: String((e as Error).message ?? e).slice(0, 300) });
    work(null, "");
  } finally {
    running.delete(game.id);
    touch();
    await saveQ;
  }

  /* ---------------- helpers that close over the run */
  async function runArt() {
    const design = season.design!;
    const style = `${design.world.mood} mood, cohesive palette (${Object.values(design.palette).join(", ")}), cozy hand-painted 2D indie game art`;
    const want = n === 1 ? design.sprites.map((s) => s.name) : (proposal?.newSprites ?? []).map((s) => s.name);
    const todo = [...new Set(want)].filter((x) => x !== "cover");
    live.artTotal = todo.length + 1;
    live.artDone = [];
    const one = async (name: string, refs: string[]) => {
      if (imagesUsed >= CAPS.imagesPerGame) return;
      imagesUsed++;
      const spec = design.sprites.find((s) => s.name === name);
      const subject = name === "cover"
        ? `${design.hero.name}: ${design.hero.look}, leaping joyfully through ${design.world.setting}. ${n > 1 ? `Season ${n}: ${proposal?.pitch ?? ""}` : ""}`
        : spec?.prompt ?? name;
      const r = await api("art", { name, subject, style, refs, genre: design.genre ?? "platformer", refMode: name === "hero" && refs.length && n === 1 ? "players" : "style" });
      addTrace(r.trace);
      season.assets[name] = String(r.dataUri);
      if (r.ref) season.refs[name] = String(r.ref);
      live.artDone.push(name);
      emit({ agent: "pixel", kind: "art", msg: `Painted ${name}${spec ? ` (${spec.role})` : ""}`, data: { name } });
    };
    work("pixel", n === 1 ? "Painting the hero first" : "Painting the new Season art");
    emit({ agent: "pixel", kind: "say", msg: n === 1 ? `Hero first, so everything else matches ${design.hero.name}'s style.` : `Reusing ${design.hero.name} as my reference so Season ${n} looks like the same world.` });
    // Players' uploaded pictures guide the hero (and so, through the hero, the whole game's look).
    const playerRefs = n === 1 ? await playerImages(game) : [];
    if (n === 1 && todo.includes("hero")) await one("hero", playerRefs);
    const heroRef = season.refs.hero ? [season.refs.hero] : [];
    const rest = todo.filter((x) => x !== "hero");
    // background first in the queue so the cover can use it
    rest.sort((a, b) => (a === "background" ? -1 : b === "background" ? 1 : 0));
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < rest.length) { const name = rest[i++]; try { await one(name, heroRef); } catch (e) { emit({ agent: "pixel", kind: "error", msg: `${name}: ${String(e).slice(0, 120)}` }); } }
    }));
    try { await one("cover", [...heroRef, ...(season.refs.background ? [season.refs.background] : [])]); } catch {}
    if (live.active === "pixel") work(null, "");
  }

  async function runTest() {
    work("tester", "Playing the build in a sandbox");
    emit({ agent: "tester", kind: "say", msg: season.tests === 0 ? (season.design?.genre === "topdown" ? "My turn! Exploring every corridor and poking everything." : "My turn! Running right, jumping, poking everything.") : "Playing the patched build again." });
    live.testing = true; touch();
    // give React a moment to mount the visible test container
    await new Promise((r) => setTimeout(r, 300));
    // In an upgrade, Tester starts on the newest level: that's what changed.
    const html = await seasonHtml(season, n > 1 ? Math.max(0, (season.design?.levels.length ?? 1) - 1) : 0);
    let report: TestReport;
    try {
      report = await playtest(html, { durationMs: 10000, container: hooks.testContainer() ?? undefined, screenshotsAt: [1500, 5000, 9000], script: scriptFor(season.design?.genre) });
    } finally {
      live.testing = false; touch();
    }
    season.tests++;
    const lint = (await api("lint", { code: season.code })).lint as { ok: boolean; issues: { id: string; message: string; warn?: boolean }[] };
    const failed = report.checks.filter((c) => !c.pass);
    emit({ agent: "tester", kind: "playtest", msg: `${report.checks.length - failed.length}/${report.checks.length} automated checks passed${failed.length ? `; failed: ${failed.map((c) => c.id).join(", ")}` : ""}`, data: { checks: report.checks } });
    work("tester", "Looking at the screenshots");
    const shots = report.screenshots.map((s) => s.dataUrl);
    const r = await api("verdict", { design: season.design, report: { checks: report.checks, errors: report.errors, trail: trail(report), screenshots: shots, lint } });
    addTrace(r.trace);
    const v = r.verdict as Verdict;
    season.test = { pass: v.verdict === "pass", checks: report.checks, verdict: v, screenshots: shots };
    status.previousBugIds = status.lastTest?.bugIds ?? [];
    const bugIds = v.bugs.filter((b) => b.severity !== "minor").map((b) => b.id);
    status.lastTest = { pass: v.verdict === "pass", bugIds, summary: v.summary };
    status.code = "tested";
    lastBugs = v.bugs;
    emit({ agent: "tester", kind: "say", msg: v.summary });
    for (const b of v.bugs) emit({ agent: "tester", kind: "bug", msg: `[${b.severity}] ${b.title}`, data: { bug: b } });
  }
}

/* ------------------------------------------------------------------ helpers */
function defaultSay(tool: ToolName): string {
  return ({
    generate_art: "Pixel, start painting while Spark codes.",
    write_code: "Spark, time to write the game.",
    run_playtest: "Tester, play it like a real player would.",
    patch_code: "Spark, please fix what Tester found.",
    escalate_to_wonder: "Same bug twice. Calling in Fixer on Muse Wonder.",
    accept_build: "Ship it!",
  } as Record<ToolName, string>)[tool];
}

function fmtTokens(t: Trace) {
  if (t.usage.images) return `${t.usage.images} image`;
  const k = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}k` : String(x));
  return `${k(t.usage.inputTokens)} in${t.usage.cachedInputTokens ? ` (${k(t.usage.cachedInputTokens)} cached)` : ""} / ${k(t.usage.outputTokens)} out`;
}

function trail(r: TestReport): string {
  const s = r.states.filter((_, i) => i % 2 === 0).map((x) => `t=${((x.t ?? 0) / 1000).toFixed(1)}s x=${x.x} y=${x.y} ${x.onGround ? "ground" : "air"} vy=${x.vy} score=${x.score} lives=${x.lives} lvl=${x.level} ${x.status}`);
  const ev = r.events.map((e) => `${e.kind}@${Number(e.t).toFixed(1)}s`).join(", ");
  return s.join("\n") + `\nevents: ${ev || "none"}`;
}

export function round2(x: number) { return Math.round(x * 100) / 100; }

/** A new idea post: no season yet. Players add details, Spark prices it, buyers fund the build. */
export function newIdea(idea: string, creator: string, images: string[] = []): GameRecord {
  const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    id, idea, creator, createdAt: Date.now(), title: idea.length > 38 ? idea.slice(0, 36) + "…" : idea,
    seasons: [], events: [], comments: [], proposal: null, owners: [], images, upvotes: [creator], rounds: [],
  };
}

/** Everything players added to an idea: the post's pictures, and detail comments (with pictures) on Season 1's thread. */
export async function materialsOf(g: GameRecord): Promise<{ name: string; text?: string; image?: string }[]> {
  const out: { name: string; text?: string; image?: string }[] = [];
  for (const im of g.images ?? []) out.push({ name: g.creator, image: await shrink(im, 512) });
  for (const c of g.comments.filter((c) => (c.season ?? 1) === 1)) out.push({ name: c.name, text: c.body || undefined, image: c.image ? await shrink(c.image, 512) : undefined });
  return out.slice(0, 40);
}
async function playerImages(g: GameRecord): Promise<string[]> {
  const all = [...(g.images ?? []), ...g.comments.filter((c) => (c.season ?? 1) === 1 && c.image).map((c) => c.image!)];
  return Promise.all(all.slice(0, 2).map((x) => shrink(x, 512)));
}

/** Resizes a picture (data URI) to fit max px, as JPEG. Used for uploads and for sending them to the models. */
export function shrink(src: string, max: number, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const x = c.getContext("2d")!;
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}
export function newSeason(n: number, budgetUsd: number): SeasonRecord {
  return { n, status: "building", design: null, code: null, assets: {}, refs: {}, test: null, tests: 0, patches: [], costUsd: 0, budgetUsd, startedAt: Date.now() };
}
