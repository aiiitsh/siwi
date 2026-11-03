// Browser-side Tester: loads a game into a hidden sandboxed iframe, plays a scripted run via the
// injected harness, and produces a TestReport. The automated checks are deterministic; the vision
// verdict (Muse Spark looking at the screenshots) happens on the server with this report as input.

export type InputStep = { at: number; key: "left" | "right" | "jump" | "down" | "action"; ms: number };

export type StateSnap = {
  t?: number; x: number; y: number; vx: number; vy: number; onGround: boolean;
  score: number; lives: number; level: number; status: string; gravity: number; frame: number;
};

export type HarnessError = { kind: string; message: string; line?: number; col?: number; stack?: string; t: number };

export type Check = { id: string; pass: boolean; detail: string };

export type TestReport = {
  booted: boolean;
  timedOut: boolean;
  durationMs: number;
  errors: HarnessError[];
  frames: { t: number; hash: string; variance: number }[];
  states: StateSnap[];
  events: { kind: string; t: number }[];
  final: StateSnap | null;
  screenshots: { at: number; dataUrl: string }[];
  checks: Check[];
  pass: boolean;
};

export const DEFAULT_SCRIPT: InputStep[] = [
  { at: 300, key: "right", ms: 1500 },
  { at: 900, key: "jump", ms: 250 },
  { at: 2000, key: "right", ms: 1200 },
  { at: 2400, key: "jump", ms: 300 },
  { at: 3400, key: "action", ms: 100 },
  { at: 3600, key: "left", ms: 600 },
  { at: 4400, key: "right", ms: 2500 },
  { at: 5000, key: "jump", ms: 300 },
  { at: 6000, key: "jump", ms: 300 },
  { at: 7000, key: "right", ms: 2000 },
  { at: 7400, key: "jump", ms: 300 },
];

export function runChecks(r: Omit<TestReport, "checks" | "pass">): Check[] {
  const checks: Check[] = [];
  checks.push({ id: "boots", pass: r.booted, detail: r.booted ? "kit booted and exposed __siwi" : "game never booted (no __siwi.state)" });
  const fatal = r.errors.filter((e) => e.kind !== "console");
  checks.push({
    id: "no_errors",
    pass: fatal.length === 0,
    detail: fatal.length ? `${fatal.length} error(s): ${fatal.slice(0, 3).map((e) => e.message + (e.line ? ` @${e.line}:${e.col}` : "")).join(" | ")}` : "no uncaught errors",
  });
  const blank = r.frames.length > 0 && r.frames.every((f) => f.variance < 20);
  checks.push({ id: "not_blank", pass: r.frames.length > 0 && !blank, detail: blank ? "canvas looks blank (flat color)" : `min variance ${Math.min(...r.frames.map((f) => f.variance))}` });
  const uniq = new Set(r.frames.map((f) => f.hash)).size;
  checks.push({ id: "animates", pass: uniq >= 3, detail: `${uniq} distinct frames out of ${r.frames.length}` });
  const xs = r.states.map((s) => s.x);
  const moved = xs.length > 1 && Math.max(...xs) - Math.min(...xs) > 60;
  checks.push({ id: "player_moves", pass: moved, detail: moved ? `player x ranged ${Math.min(...xs)}..${Math.max(...xs)}` : "player did not move with right/left input" });
  const jumped = r.events.some((e) => e.kind === "jump");
  checks.push({ id: "player_jumps", pass: jumped, detail: jumped ? "jump registered" : "jump input never produced a jump" });
  const progress = r.events.some((e) => ["collect", "stomp", "powerup", "level_complete", "won", "hurt", "lost"].includes(e.kind));
  checks.push({ id: "interactions", pass: progress, detail: progress ? "player interacted with the world" : "no collect/stomp/hurt/win events in the run" });
  return checks;
}

let counter = 0;

/** Runs a game HTML in a hidden sandboxed iframe. Must be called in the browser. */
export function playtest(html: string, opts: { durationMs?: number; script?: InputStep[]; screenshotsAt?: number[]; container?: HTMLElement } = {}): Promise<TestReport> {
  const durationMs = opts.durationMs ?? 10000;
  const id = `run-${Date.now()}-${counter++}`;
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.cssText = opts.container
      ? "width:100%;aspect-ratio:16/9;border:0;display:block"
      : // Must stay on-screen and painted: browsers pause requestAnimationFrame in hidden/offscreen iframes.
        "position:fixed;right:8px;bottom:8px;width:240px;height:135px;border:0;opacity:0.02;pointer-events:none;z-index:1";
    const shots: { at: number; dataUrl: string }[] = [];
    const errors: HarnessError[] = [];
    let ready = false;
    let done = false;

    const finish = (partial: Partial<TestReport>) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      clearTimeout(bootTimer);
      clearTimeout(hardTimer);
      const base = {
        booted: partial.booted ?? ready,
        timedOut: partial.timedOut ?? false,
        durationMs,
        errors: partial.errors ?? errors,
        frames: partial.frames ?? [],
        states: partial.states ?? [],
        events: partial.events ?? [],
        final: partial.final ?? null,
        screenshots: shots,
      };
      const checks = runChecks(base);
      if (!opts.container) iframe.remove();
      resolve({ ...base, checks, pass: checks.every((c) => c.pass) });
    };

    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      const m = ev.data || {};
      if (m.source !== "siwi-game") return;
      if (m.type === "siwi:error") errors.push(m.error);
      if (m.type === "siwi:screenshot" && m.id === id) shots.push({ at: m.at, dataUrl: m.dataUrl });
      if (m.type === "siwi:ready" && !ready) {
        ready = true;
        iframe.contentWindow?.postMessage({ type: "siwi:run", id, durationMs, script: opts.script ?? DEFAULT_SCRIPT, screenshotsAt: opts.screenshotsAt ?? [1000, 4000, 8000] }, "*");
      }
      if (m.type === "siwi:report" && m.id === id) {
        finish({ booted: m.booted, errors: m.errors?.length ? m.errors : errors, frames: m.frames, states: m.states, events: m.events, final: m.final });
      }
    };
    window.addEventListener("message", onMsg);
    // If the kit never boots (syntax error etc.), give up after 6 s; hard cap at duration + 8 s.
    const bootTimer = setTimeout(() => { if (!ready) finish({ booted: false, timedOut: true }); }, 6000);
    const hardTimer = setTimeout(() => finish({ timedOut: true }), durationMs + 8000);

    // One visible sandbox at a time: a leftover iframe would push this one offscreen, and browsers
    // throttle requestAnimationFrame in offscreen iframes (every check would then fail).
    if (opts.container) opts.container.replaceChildren(iframe);
    else document.body.appendChild(iframe);
    iframe.srcdoc = html;
  });
}
