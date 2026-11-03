/*!
 * siwi-harness.js — injected into every generated game so the Tester agent can play it.
 * Talks to the parent page with postMessage. Never throws.
 *
 * parent -> game:  { type:"siwi:run", id, durationMs, script:[{at,key,ms}], screenshotsAt:[ms] }
 * game -> parent:  { type:"siwi:error"|"siwi:ready"|"siwi:frame"|"siwi:screenshot"|"siwi:report", id?, ... }
 */
(function () {
  "use strict";
  const errors = [];
  const post = (msg) => { try { parent.postMessage(Object.assign({ source: "siwi-game" }, msg), "*"); } catch (_) {} };

  function pushError(kind, message, extra) {
    const e = Object.assign({ kind, message: String(message).slice(0, 500), t: Math.round(performance.now()) }, extra || {});
    errors.push(e);
    if (errors.length > 50) errors.shift();
    post({ type: "siwi:error", error: e });
  }
  window.addEventListener("error", (ev) => {
    pushError("error", ev.message || (ev.error && ev.error.message) || "unknown error", {
      line: ev.lineno, col: ev.colno, stack: ev.error && ev.error.stack ? String(ev.error.stack).slice(0, 800) : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (ev) => pushError("rejection", ev.reason && ev.reason.message ? ev.reason.message : ev.reason));
  const origError = console.error;
  console.error = function () { try { pushError("console", Array.from(arguments).join(" ")); } catch (_) {} return origError.apply(console, arguments); };

  function canvas() { return document.getElementById("game") || document.querySelector("canvas"); }

  // Downscale the canvas to 32x18 and return a hash plus a "blankness" measure.
  const small = document.createElement("canvas");
  small.width = 32; small.height = 18;
  function frameStats() {
    const cv = canvas();
    if (!cv) return { hash: "none", variance: 0 };
    try {
      const sctx = small.getContext("2d", { willReadFrequently: true });
      sctx.drawImage(cv, 0, 0, 32, 18);
      const d = sctx.getImageData(0, 0, 32, 18).data;
      let h = 2166136261, sum = 0, sumSq = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
        sum += v; sumSq += v * v; n++;
        h ^= (d[i] >> 3) | ((d[i + 1] >> 3) << 5) | ((d[i + 2] >> 3) << 10);
        h = Math.imul(h, 16777619) >>> 0;
      }
      const mean = sum / n;
      return { hash: h.toString(16), variance: Math.round(sumSq / n - mean * mean) };
    } catch (err) {
      return { hash: "tainted", variance: -1, error: String(err) };
    }
  }

  function snapshot() {
    const s = window.__siwi && window.__siwi.state;
    if (!s) return null;
    const p = s.player || {};
    return {
      x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx || 0), vy: Math.round(p.vy || 0),
      onGround: !!p.onGround, score: s.score, lives: s.lives, level: s.level, status: s.status,
      gravity: s.gravity, frame: s.frame, mode: s.mode || "platformer",
    };
  }

  function screenshot() {
    const cv = canvas();
    if (!cv) return null;
    try { return cv.toDataURL("image/jpeg", 0.7); } catch (_) { return null; }
  }

  // Tell the parent when the kit has booted.
  let readyPosted = false;
  const readyTimer = setInterval(() => {
    if (window.__siwi && window.__siwi.state && !readyPosted) {
      readyPosted = true; clearInterval(readyTimer);
      post({ type: "siwi:ready", version: window.__siwi.version, state: snapshot() });
    }
  }, 50);

  window.addEventListener("message", (ev) => {
    const msg = ev.data || {};
    if (msg.type !== "siwi:run") return;
    run(msg);
  });

  function run(cmd) {
    const id = cmd.id;
    const duration = cmd.durationMs || 10000;
    const t0 = performance.now();
    const frames = [], states = [], events = [];
    const shots = (cmd.screenshotsAt || [1000, 4000, 8000]).slice().sort((a, b) => a - b);
    const script = (cmd.script || []).slice().sort((a, b) => a.at - b.at);

    if (window.Siwi && window.Siwi.audio) window.Siwi.audio.muted = true;

    const tick = setInterval(() => {
      const t = performance.now() - t0;
      while (script.length && script[0].at <= t) {
        const step = script.shift();
        try { window.Siwi.input.press(step.key, step.ms || 120); } catch (err) { pushError("harness", "input failed: " + err); }
      }
      while (shots.length && shots[0] <= t) {
        const at = shots.shift();
        const img = screenshot();
        if (img) post({ type: "siwi:screenshot", id, at, dataUrl: img });
      }
      if (Math.floor(t / 500) > frames.length - 1) {
        frames.push(Object.assign({ t: Math.round(t) }, frameStats()));
        const s = snapshot();
        if (s) states.push(Object.assign({ t: Math.round(t) }, s));
      }
      if (t >= duration) {
        clearInterval(tick);
        const evs = (window.__siwi && window.__siwi.state && window.__siwi.state.events) || [];
        for (const e of evs) events.push(e);
        post({ type: "siwi:report", id, booted: !!window.__siwi, errors: errors.slice(), frames, states, events, final: snapshot() });
      }
    }, 50);
  }
})();
