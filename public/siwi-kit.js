/*!
 * siwi-kit.js — the hand-written engine every Siwi game runs on.
 * Plain JS, no dependencies. Canvas 960x540, fixed 60 Hz timestep.
 *
 * Two layers:
 *   Siwi.createGame({ width, height, assets, init, update, draw })  low-level loop
 *   Siwi.platformer(config)                                         data-driven side-view platformer
 *   Siwi.topdown(config)                                            data-driven top-down explorer (mazes, keys, lantern light)
 *
 * The harness reads window.__siwi.state:
 *   { player:{x,y,vx,vy,onGround,facing}, score, lives, level, levelCount, status, frame, time, gravity, events[] }
 */
(function () {
  "use strict";

  const W = 960, H = 540, DT = 1 / 60;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* ------------------------------------------------------------------ input */
  const KEYMAP = {
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
    ArrowUp: "up", w: "up", W: "up", " ": "jump", Space: "jump",
    ArrowDown: "down", s: "down", S: "down",
    x: "action", X: "action", Shift: "action", f: "action", F: "action",
    r: "restart", R: "restart", Enter: "restart",
    p: "pause", P: "pause", Escape: "pause",
  };
  const input = {
    down: Object.create(null),
    pressed: Object.create(null), // true only on the frame the key went down
    _synthetic: [],
    isDown(k) { return !!this.down[k]; },
    wasPressed(k) { return !!this.pressed[k]; },
    /** Harness / scripted input: hold a logical key ("left","right","jump","down","action") for ms. */
    press(k, ms = 120) {
      this._set(k, true);
      this._synthetic.push({ k, until: performance.now() + ms });
    },
    _set(k, v) {
      if (v && !this.down[k]) this.pressed[k] = true;
      this.down[k] = v;
      if (v) audio.unlock();
    },
    _tick() {
      const now = performance.now();
      this._synthetic = this._synthetic.filter((s) => {
        if (now >= s.until) { this._set(s.k, false); return false; }
        return true;
      });
    },
    _endFrame() { this.pressed = Object.create(null); },
  };
  addEventListener("keydown", (e) => {
    const k = KEYMAP[e.key] || KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    input._set(k, true);
  });
  addEventListener("keyup", (e) => {
    const k = KEYMAP[e.key] || KEYMAP[e.code];
    if (k) input._set(k, false);
  });
  addEventListener("blur", () => { for (const k in input.down) input.down[k] = false; });

  /* ------------------------------------------------------------------ touch controls (phones / tablets) */
  function addTouchControls() {
    if (!(window.matchMedia && matchMedia("(pointer: coarse)").matches)) return;
    const css = document.createElement("style");
    css.textContent =
      ".siwi-pad{position:fixed;bottom:2vmin;display:flex;gap:2vmin;z-index:5;user-select:none;-webkit-user-select:none;touch-action:none}" +
      ".siwi-pad button{width:clamp(34px,13vmin,64px);height:clamp(34px,13vmin,64px);border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(11,16,48,.35);" +
      "color:#fff;font:800 clamp(14px,5vmin,24px) Inter,system-ui,sans-serif;touch-action:none;opacity:.8}" +
      ".siwi-pad button.on{background:rgba(255,111,165,.55)}";
    document.head.appendChild(css);
    const pad = (side, keys) => {
      const el = document.createElement("div");
      el.className = "siwi-pad";
      el.style[side] = "14px";
      for (const [k, label] of keys) {
        const b = document.createElement("button");
        b.textContent = label;
        const on = (e) => { e.preventDefault(); b.classList.add("on"); input._set(k, true); };
        const off = (e) => { e.preventDefault(); b.classList.remove("on"); input._set(k, false); };
        b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off);
        b.addEventListener("pointercancel", off); b.addEventListener("pointerleave", off);
        el.appendChild(b);
      }
      document.body.appendChild(el);
    };
    if (touchMode === "topdown") {
      pad("left", [["left", "◀"], ["up", "▲"], ["down", "▼"], ["right", "▶"]]);
      pad("right", [["action", "✦"]]);
    } else {
      pad("left", [["left", "◀"], ["right", "▶"]]);
      pad("right", [["action", "✦"], ["jump", "▲"]]);
    }
  }
  let touchMode = "platformer";
  function setupTouch(mode) {
    touchMode = mode;
    if (document.body) addTouchControls(); else addEventListener("DOMContentLoaded", addTouchControls);
  }

  /* ------------------------------------------------------------------ audio (tiny WebAudio beeps, no files) */
  const audio = {
    ctx: null,
    muted: false,
    unlock() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch (_) { /* no audio available */ }
    },
    beep(freq = 440, dur = 0.08, type = "square", vol = 0.06, slide = 0) {
      if (this.muted || !this.ctx || this.ctx.state !== "running") return;
      try {
        const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
      } catch (_) { /* ignore */ }
    },
  };
  const SFX = {
    jump: () => audio.beep(520, 0.12, "square", 0.05, 380),
    coin: () => { audio.beep(880, 0.06, "square", 0.05); setTimeout(() => audio.beep(1320, 0.08, "square", 0.05), 60); },
    stomp: () => audio.beep(220, 0.1, "triangle", 0.08, -120),
    hurt: () => audio.beep(160, 0.25, "sawtooth", 0.07, -100),
    power: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => audio.beep(f, 0.08, "square", 0.05), i * 70)),
    win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => audio.beep(f, 0.12, "triangle", 0.07), i * 110)),
    lose: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => audio.beep(f, 0.16, "triangle", 0.07), i * 150)),
    flip: () => audio.beep(300, 0.15, "sine", 0.07, 500),
  };

  /* ------------------------------------------------------------------ assets */
  function loadImages(assets) {
    const out = {};
    const jobs = Object.entries(assets || {}).map(([name, src]) => new Promise((res) => {
      if (!src) return res();
      const img = new Image();
      img.onload = () => { out[name] = img; res(); };
      img.onerror = () => { console.warn("[siwi] asset failed to load:", name); res(); };
      img.src = src;
    }));
    return Promise.all(jobs).then(() => out);
  }

  /** Draw an image centered at (x,y) fitting w x h, with optional flip / squash. */
  function drawSprite(ctx, img, x, y, w, h, o = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale((o.flip ? -1 : 1) * (o.sx || 1), (o.flipY ? -1 : 1) * (o.sy || 1));
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.imageSmoothingEnabled = o.smooth !== false;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ canvas + loop */
  function makeCanvas(width, height) {
    let cv = document.getElementById("game");
    if (!cv) {
      cv = document.createElement("canvas");
      cv.id = "game";
      document.body.appendChild(cv);
    }
    cv.width = width; cv.height = height;
    const style = document.createElement("style");
    style.textContent =
      "html,body{margin:0;height:100%;background:#07091A;overflow:hidden}" +
      "#game{display:block;position:absolute;inset:0;margin:auto;max-width:100%;max-height:100%;" +
      "aspect-ratio:" + width + "/" + height + ";width:100%;height:auto;image-rendering:auto}";
    document.head.appendChild(style);
    cv.tabIndex = 0;
    cv.addEventListener("pointerdown", () => { cv.focus(); audio.unlock(); });
    return cv;
  }

  function createGame(opts) {
    const width = opts.width || W, height = opts.height || H;
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const game = {
      canvas, ctx, width, height, images: {}, paused: false, frame: 0, time: 0,
      restart() { if (opts.init) opts.init(game); },
    };
    let acc = 0, last = 0, started = false, userActive = false;
    // Auto-pause when a real player clicks away (never during the Tester's scripted run, which has no user input).
    const wake = (e) => { if (e && e.isTrusted) userActive = true; if (game.autoPaused) { game.paused = false; game.autoPaused = false; } };
    addEventListener("keydown", wake, true);
    addEventListener("pointerdown", wake, true);
    addEventListener("blur", () => { if (userActive && !game.paused) { game.paused = true; game.autoPaused = true; } });
    function frame(ts) {
      requestAnimationFrame(frame);
      if (!last) last = ts;
      acc += Math.min(0.25, (ts - last) / 1000);
      last = ts;
      input._tick();
      if (input.wasPressed("pause")) game.paused = !game.paused;
      while (acc >= DT) {
        if (!game.paused) {
          opts.update && opts.update(game, DT);
          game.frame++; game.time += DT;
        }
        input._endFrame();
        acc -= DT;
      }
      opts.draw && opts.draw(game, ctx);
      if (game.paused) {
        ctx.fillStyle = "rgba(7,9,26,.6)"; ctx.fillRect(0, 0, width, height);
        text(ctx, "PAUSED", width / 2, height / 2 - 14, 48, "#fff", "center");
        text(ctx, game.autoPaused ? "click or press any key to keep playing" : "press P to resume", width / 2, height / 2 + 32, 20, "rgba(255,255,255,.75)", "center", 600);
      }
    }
    loadImages(opts.assets).then((imgs) => {
      game.images = imgs;
      if (opts.init) opts.init(game);
      if (!started) { started = true; requestAnimationFrame(frame); }
    });
    return game;
  }

  function text(ctx, s, x, y, size, col, align = "left", weight = 800) {
    ctx.font = weight + " " + size + "px Inter, system-ui, sans-serif";
    ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, size / 7); ctx.strokeStyle = "rgba(7,9,26,.85)";
    ctx.strokeText(s, x, y);
    ctx.fillStyle = col; ctx.fillText(s, x, y);
  }

  /* ------------------------------------------------------------------ platformer */
  const TILE = 48;
  // Default legend. A game's config.legend can override or add characters.
  const DEFAULT_LEGEND = {
    "#": { type: "solid" },
    "=": { type: "solid", sprite: "platform" },
    "-": { type: "oneway", sprite: "platform" },
    "P": { type: "player" },
    "C": { type: "collectible", sprite: "collectible", value: 10 },
    "E": { type: "enemy", sprite: "enemy", speed: 70, stompable: true },
    "F": { type: "enemy", sprite: "enemy2", speed: 0, flying: true, amplitude: 60, stompable: true },
    "^": { type: "hazard", sprite: "hazard" },
    "G": { type: "goal", sprite: "goal" },
    "U": { type: "powerup", sprite: "powerup", power: "doubleJump" },
    "K": { type: "checkpoint" },
  };
  const DEFAULT_PALETTE = {
    sky: "#1b2a6b", skyBottom: "#0B1030", ground: "#3b2f63", groundTop: "#8B6CFF",
    accent: "#FFC83D", hud: "#ffffff", hazard: "#FF5A6E", collectible: "#FFC83D", enemy: "#FF6FA5", player: "#29D8F5",
  };

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /**
   * Siwi.platformer(config)
   * config = {
   *   title, assets:{hero,background,platform,collectible,enemy,enemy2,hazard,goal,powerup,...data URIs},
   *   palette:{...}, legend:{char:{type,sprite,...}}, levels:[{name, rows:[strings], background?}],
   *   player:{ speed:260, jump:640, w:36, h:44, drawW:56, drawH:56, doubleJump:false, lives:3 },
   *   gravity:1800, gravityFlip:false,
   *   hooks:{ onStart(api), onUpdate(api,dt), onDraw(ctx,api), onCollect(item,api), onStomp(enemy,api),
   *           onPowerup(item,api), onHurt(api), onLevelStart(api), onWin(api) }
   * }
   */
  function platformer(cfg) {
    setupTouch("platformer");
    const legend = Object.assign({}, DEFAULT_LEGEND, cfg.legend || {});
    const pal = Object.assign({}, DEFAULT_PALETTE, cfg.palette || {});
    const P = Object.assign({ speed: 260, jump: 640, w: 34, h: 44, drawW: 58, drawH: 58, doubleJump: false, lives: 3 }, cfg.player || {});
    const hooks = cfg.hooks || {};
    const GRAV = cfg.gravity || 1800;
    const levels = (cfg.levels || []).filter((l) => l && Array.isArray(l.rows) && l.rows.length);
    if (!levels.length) throw new Error("siwi: config.levels is empty");

    const state = {
      player: { x: 0, y: 0, vx: 0, vy: 0, w: P.w, h: P.h, onGround: false, facing: 1 },
      score: 0, lives: P.lives, level: 0, levelCount: levels.length, status: "playing",
      frame: 0, time: 0, gravity: 1, events: [], mode: "platformer",
    };
    const lighting = makeLighting(cfg);
    let grid = [], cols = 0, rows = 0, entities = [], particles = [], floaters = [];
    let spawn = { x: 0, y: 0 }, cam = { x: 0, y: 0 }, shakeT = 0, shakeMag = 0;
    let invuln = 0, jumpsLeft = 0, squash = 1, powers = {}, coyote = 0, jumpBuffer = 0, endTimer = 0;
    let game;

    function logEvent(kind, data) {
      state.events.push(Object.assign({ kind, t: +state.time.toFixed(2) }, data || {}));
      if (state.events.length > 60) state.events.shift();
    }

    /* ----- level parsing */
    function loadLevel(i) {
      const L = levels[i];
      rows = L.rows.length;
      cols = Math.max.apply(null, L.rows.map((r) => r.length));
      grid = []; entities = []; particles = []; floaters = [];
      spawn = { x: TILE, y: (rows - 3) * TILE };
      for (let r = 0; r < rows; r++) {
        grid.push(new Array(cols).fill(null));
        for (let c = 0; c < cols; c++) {
          const ch = L.rows[r][c] || ".";
          const def = legend[ch];
          if (!def) continue;
          const x = c * TILE, y = r * TILE;
          if (def.type === "solid" || def.type === "oneway") grid[r][c] = def;
          else if (def.type === "player") spawn = { x: x + (TILE - P.w) / 2, y: y + TILE - P.h };
          else {
            const size = def.size || (def.type === "goal" ? 64 : def.type === "enemy" ? 44 : 34);
            entities.push(Object.assign({}, def, {
              ch, x: x + (TILE - size) / 2, y: y + TILE - size, w: size, h: size,
              x0: x, y0: y + TILE - size, dir: -1, alive: true, t: Math.random() * 6,
            }));
          }
        }
      }
      state.level = i;
      state.status = "playing";
      endTimer = 0;
      respawn(true);
      logEvent("level_start", { level: i });
      hooks.onLevelStart && hooks.onLevelStart(api);
    }

    function respawn(full) {
      const p = state.player;
      p.x = spawn.x; p.y = spawn.y; p.vx = 0; p.vy = 0; p.onGround = false;
      state.gravity = 1;
      if (!full) invuln = 1.5;
      jumpsLeft = 0;
    }

    let firstLoad = true;
    function reset() {
      state.score = 0; state.lives = P.lives; powers = {};
      // SIWI_START_LEVEL lets the page open straight into a level (e.g. the new Season 2 level).
      const start = firstLoad ? clamp((window.SIWI_START_LEVEL | 0), 0, levels.length - 1) : 0;
      firstLoad = false;
      loadLevel(start);
    }

    /* ----- tiles */
    function tileAt(c, r) {
      if (c < 0 || c >= cols) return legend["#"]; // walls at level edges
      if (r < 0 || r >= rows) return null;
      return grid[r][c];
    }
    function solidAt(c, r) { const t = tileAt(c, r); return t && t.type === "solid"; }

    function moveX(o, dx) {
      o.x += dx;
      const r0 = Math.floor(o.y / TILE), r1 = Math.floor((o.y + o.h - 1) / TILE);
      if (dx > 0) {
        const c = Math.floor((o.x + o.w - 1) / TILE);
        for (let r = r0; r <= r1; r++) if (solidAt(c, r)) { o.x = c * TILE - o.w; return true; }
      } else if (dx < 0) {
        const c = Math.floor(o.x / TILE);
        for (let r = r0; r <= r1; r++) if (solidAt(c, r)) { o.x = (c + 1) * TILE; return true; }
      }
      return false;
    }
    // Returns "floor" when landing in the gravity direction, "ceil" when bonking, else null.
    function moveY(o, dy, g) {
      const prevTop = o.y, prevBottom = o.y + o.h;
      o.y += dy;
      const c0 = Math.floor(o.x / TILE), c1 = Math.floor((o.x + o.w - 1) / TILE);
      if (dy > 0) {
        const r = Math.floor((o.y + o.h - 1) / TILE);
        for (let c = c0; c <= c1; c++) {
          const t = tileAt(c, r);
          if (!t) continue;
          if (t.type === "solid" || (t.type === "oneway" && g > 0 && prevBottom <= r * TILE + 1)) {
            o.y = r * TILE - o.h; return g > 0 ? "floor" : "ceil";
          }
        }
      } else if (dy < 0) {
        const r = Math.floor(o.y / TILE);
        for (let c = c0; c <= c1; c++) {
          const t = tileAt(c, r);
          if (!t) continue;
          if (t.type === "solid" || (t.type === "oneway" && g < 0 && prevTop >= (r + 1) * TILE - 1)) {
            o.y = (r + 1) * TILE; return g < 0 ? "floor" : "ceil";
          }
        }
      }
      return null;
    }

    /* ----- fx */
    function burst(x, y, color, n = 14, speed = 220) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rand(0.4, 0.8), max: 0.8, color, size: rand(3, 7) });
      }
    }
    function confetti(x, y) {
      const cols_ = ["#FF6FA5", "#8B6CFF", "#29D8F5", "#A8F03A", "#FFC83D", "#ffffff"];
      for (let i = 0; i < 80; i++) {
        const a = -Math.PI / 2 + rand(-1, 1), s = rand(250, 650);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(1, 1.8), max: 1.8, color: cols_[i % 6], size: rand(4, 9), rect: true });
      }
    }
    function shake(mag = 8, t = 0.25) { shakeMag = mag; shakeT = t; }
    function floatText(s, x, y, color) { floaters.push({ s, x, y, color: color || pal.accent, life: 0.9 }); }

    /* ----- gameplay */
    function addScore(n, x, y) {
      state.score += n;
      if (x != null) floatText("+" + n, x, y);
    }
    function hurt() {
      if (invuln > 0 || state.status !== "playing") return;
      if (powers.shield) { powers.shield = false; invuln = 1; shake(5); SFX.stomp(); logEvent("shield_used"); return; }
      state.lives--;
      logEvent("hurt", { lives: state.lives });
      SFX.hurt(); shake(12, 0.35);
      burst(state.player.x + P.w / 2, state.player.y + P.h / 2, pal.hazard, 22, 300);
      hooks.onHurt && hooks.onHurt(api);
      if (state.lives <= 0) { lose(); return; }
      respawn(false);
    }
    function lose() {
      state.status = "lost"; endTimer = 0;
      logEvent("lost"); SFX.lose();
    }
    function win() {
      if (state.status !== "playing") return;
      const p = state.player;
      confetti(p.x + P.w / 2, p.y);
      SFX.win();
      if (state.level < levels.length - 1) {
        state.status = "levelComplete"; endTimer = 0;
        logEvent("level_complete", { level: state.level });
      } else {
        state.status = "won"; endTimer = 0;
        logEvent("won", { score: state.score });
        hooks.onWin && hooks.onWin(api);
      }
    }
    function tryJump() {
      const p = state.player;
      const canGround = p.onGround || coyote > 0;
      const maxAir = (P.doubleJump || powers.doubleJump) ? 1 : 0;
      if (canGround) jumpsLeft = maxAir;
      else if (jumpsLeft <= 0) return false;
      else jumpsLeft--;
      p.vy = -P.jump * state.gravity * (powers.superJump ? 1.25 : 1);
      p.onGround = false; coyote = 0;
      squash = 1.35;
      SFX.jump();
      burst(p.x + P.w / 2, state.gravity > 0 ? p.y + P.h : p.y, "rgba(255,255,255,.7)", 6, 90);
      logEvent("jump", { air: !canGround });
      return true;
    }

    function update(g, dt) {
      state.frame++; state.time += dt;
      if (shakeT > 0) shakeT -= dt;
      updateFx(dt);
      if (input.wasPressed("restart") && state.status !== "playing") { reset(); return; }

      if (state.status === "levelComplete") {
        endTimer += dt;
        if (endTimer > 1.6) { const sc = state.score, lv = state.lives; loadLevel(state.level + 1); state.score = sc; state.lives = lv; }
        return;
      }
      if (state.status !== "playing") { endTimer += dt; return; }

      const p = state.player;
      if (invuln > 0) invuln -= dt;
      squash = lerp(squash, 1, 0.18);

      // horizontal
      const speed = P.speed * (powers.speed ? 1.4 : 1);
      const dir = (input.isDown("right") ? 1 : 0) - (input.isDown("left") ? 1 : 0);
      const target = dir * speed;
      p.vx = lerp(p.vx, target, p.onGround ? 0.25 : 0.12);
      if (Math.abs(p.vx) < 2) p.vx = 0;
      if (dir) p.facing = dir;
      moveX(p, p.vx * dt);

      // gravity flip
      if (cfg.gravityFlip && input.wasPressed("action") && (p.onGround || coyote > 0)) {
        state.gravity *= -1; p.onGround = false; coyote = 0; p.vy = 0;
        SFX.flip(); shake(4, 0.15); logEvent("gravity_flip", { gravity: state.gravity });
      }

      // jump (buffered)
      if (input.wasPressed("jump") || input.wasPressed("up")) jumpBuffer = 0.12;
      if (jumpBuffer > 0) { jumpBuffer -= dt; if (tryJump()) jumpBuffer = 0; }
      // variable jump height
      if (!input.isDown("jump") && !input.isDown("up") && p.vy * state.gravity < -200) p.vy *= 0.85;

      // vertical
      p.vy += GRAV * state.gravity * dt;
      p.vy = clamp(p.vy, -1400, 1400);
      const wasGround = p.onGround;
      const hit = moveY(p, p.vy * dt, state.gravity);
      if (hit === "floor") {
        if (!wasGround && Math.abs(p.vy) > 300) { squash = 0.7; burst(p.x + P.w / 2, state.gravity > 0 ? p.y + P.h : p.y, "rgba(255,255,255,.5)", 5, 60); }
        p.vy = 0; p.onGround = true; coyote = 0.08;
      } else {
        if (hit === "ceil") p.vy = 0;
        if (p.onGround) coyote = 0.08;
        p.onGround = false;
        if (coyote > 0) coyote -= dt;
      }

      // fell out of the world
      if (p.y > rows * TILE + 200 || p.y < -400) hurt();

      // entities
      const pBox = { x: p.x, y: p.y, w: P.w, h: P.h };
      for (const e of entities) {
        if (!e.alive) continue;
        e.t += dt;
        if (e.type === "enemy") {
          if (e.flying) {
            e.y = e.y0 + Math.sin(e.t * 2) * (e.amplitude || 60);
            if (e.speed) { e.x += e.dir * e.speed * dt; if (Math.abs(e.x - e.x0) > 3 * TILE) e.dir *= -1; }
          } else if (e.speed) {
            const prevX = e.x;
            const blocked = moveX(e, e.dir * e.speed * dt);
            const aheadC = Math.floor((e.dir > 0 ? e.x + e.w + 1 : e.x - 1) / TILE);
            const belowR = Math.floor((e.y + e.h + 2) / TILE);
            const t = tileAt(aheadC, belowR);
            if (blocked || !t) { e.x = prevX; e.dir *= -1; }
          }
        }
        if (e.type === "custom" && typeof e.update === "function") {
          try { e.update(e, api, dt); } catch (err) { reportError(err); }
        }
        if (!overlap(pBox, e)) continue;
        touch(e, p);
      }
      entities = entities.filter((e) => e.alive);

      // camera
      const levelW = cols * TILE, levelH = rows * TILE;
      const tx = clamp(p.x + P.w / 2 - W / 2 + p.facing * 60, 0, Math.max(0, levelW - W));
      const ty = clamp(p.y + P.h / 2 - H / 2, 0, Math.max(0, levelH - H));
      cam.x = lerp(cam.x, tx, 0.12); cam.y = lerp(cam.y, ty, 0.12);

      if (hooks.onUpdate) { try { hooks.onUpdate(api, dt); } catch (err) { reportError(err); } }
    }

    function touch(e, p) {
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (e.type === "collectible") {
        e.alive = false;
        addScore(e.value || 10, cx, e.y);
        SFX.coin(); burst(cx, cy, pal.collectible, 12, 180);
        logEvent("collect", { score: state.score });
        hooks.onCollect && hooks.onCollect(e, api);
      } else if (e.type === "powerup") {
        e.alive = false;
        powers[e.power || "doubleJump"] = true;
        if (e.power === "extraLife") state.lives++;
        floatText((e.label || e.power || "power").toUpperCase() + "!", cx, e.y, "#A8F03A");
        SFX.power(); burst(cx, cy, "#A8F03A", 24, 260);
        logEvent("powerup", { power: e.power });
        hooks.onPowerup && hooks.onPowerup(e, api);
      } else if (e.type === "hazard") {
        hurt();
      } else if (e.type === "goal") {
        win();
      } else if (e.type === "checkpoint") {
        if (!e.reached) { e.reached = true; spawn = { x: e.x0 + (TILE - P.w) / 2, y: e.y0 + e.h - P.h }; floatText("CHECKPOINT", cx, e.y, "#29D8F5"); SFX.coin(); logEvent("checkpoint"); }
      } else if (e.type === "enemy") {
        const g = state.gravity;
        const falling = p.vy * g > 50;
        const fromAbove = g > 0 ? p.y + P.h - p.vy * DT <= e.y + 10 : p.y - p.vy * DT >= e.y + e.h - 10;
        if (e.stompable !== false && falling && fromAbove) {
          e.alive = false;
          p.vy = -P.jump * 0.6 * g;
          addScore(e.value || 50, cx, e.y);
          SFX.stomp(); shake(5, 0.15); burst(cx, cy, pal.enemy, 18, 240);
          logEvent("stomp", { score: state.score });
          hooks.onStomp && hooks.onStomp(e, api);
        } else hurt();
      } else if (e.type === "custom" && typeof e.touch === "function") {
        try { e.touch(e, api); } catch (err) { reportError(err); }
      }
    }

    function updateFx(dt) {
      for (const q of particles) { q.life -= dt; q.vy += 900 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
      particles = particles.filter((q) => q.life > 0);
      for (const f of floaters) { f.life -= dt; f.y -= 50 * dt; }
      floaters = floaters.filter((f) => f.life > 0);
    }

    /* ----- drawing */
    function drawBackground(ctx, imgs) {
      const L = levels[state.level];
      const bg = imgs[(L && L.background) || "background"];
      if (bg) {
        const s = Math.max(W / bg.width, H / bg.height) * 1.15;
        const bw = bg.width * s, bh = bg.height * s;
        const ox = -((cam.x * 0.3) % bw);
        for (let x = ox; x < W; x += bw) ctx.drawImage(bg, x, (H - bh) / 2 - cam.y * 0.1, bw, bh);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, pal.sky); g.addColorStop(1, pal.skyBottom);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255,255,255,.5)";
        for (let i = 0; i < 40; i++) {
          const x = ((i * 137.5 - cam.x * 0.15) % W + W) % W, y = (i * 71) % (H * 0.6);
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }

    function drawTiles(ctx, imgs) {
      const c0 = Math.max(0, Math.floor(cam.x / TILE)), c1 = Math.min(cols - 1, Math.ceil((cam.x + W) / TILE));
      const r0 = Math.max(0, Math.floor(cam.y / TILE)), r1 = Math.min(rows - 1, Math.ceil((cam.y + H) / TILE));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const t = grid[r][c];
        if (!t) continue;
        const x = c * TILE, y = r * TILE;
        const img = imgs[t.sprite || "tile"] || imgs.tile;
        if (t.type === "oneway") {
          if (img) ctx.drawImage(img, x, y, TILE, TILE * 0.4);
          else { ctx.fillStyle = pal.groundTop; roundRect(ctx, x + 1, y, TILE - 2, 14, 6); ctx.fill(); }
          continue;
        }
        if (img) { ctx.drawImage(img, x, y, TILE, TILE); continue; }
        const topOpen = !(r > 0 && grid[r - 1][c] && grid[r - 1][c].type === "solid");
        ctx.fillStyle = pal.ground; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "rgba(0,0,0,.15)"; ctx.fillRect(x, y + TILE - 6, TILE, 6);
        ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.fillRect(x + 6, y + 14, 8, 8); ctx.fillRect(x + 28, y + 30, 6, 6);
        if (topOpen) { ctx.fillStyle = pal.groundTop; ctx.fillRect(x, y, TILE, 10); ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(x, y, TILE, 3); }
      }
    }

    function drawEntity(ctx, e, imgs) {
      const img = imgs[e.sprite];
      const bob = e.type === "collectible" || e.type === "powerup" ? Math.sin(e.t * 4) * 4 : 0;
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + bob;
      const flipY = state.gravity < 0 && e.type === "enemy" && false;
      if (e.type === "custom" && typeof e.draw === "function") { try { e.draw(ctx, e, api); } catch (err) { reportError(err); } return; }
      if (img) {
        const s = e.type === "goal" ? 1.2 : e.type === "enemy" ? 1.25 : 1.15;
        const wob = e.type === "enemy" ? 1 + Math.sin(e.t * 10) * 0.05 : 1;
        drawSprite(ctx, img, cx, cy, e.w * s, e.h * s, { flip: e.dir > 0, sy: wob, flipY });
        return;
      }
      // fallback shapes so a game is playable even without art
      ctx.save();
      if (e.type === "collectible") {
        ctx.fillStyle = pal.collectible; ctx.shadowColor = pal.collectible; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 10, cy); ctx.lineTo(cx, cy + 12); ctx.lineTo(cx - 10, cy); ctx.closePath(); ctx.fill();
      } else if (e.type === "enemy") {
        ctx.fillStyle = pal.enemy; roundRect(ctx, e.x, e.y + 6, e.w, e.h - 6, 14); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(cx - 10 + e.dir * 4, cy - 4, 6, 9); ctx.fillRect(cx + 4 + e.dir * 4, cy - 4, 6, 9);
      } else if (e.type === "hazard") {
        ctx.fillStyle = pal.hazard;
        for (let i = 0; i < 3; i++) { const x = e.x + i * e.w / 3; ctx.beginPath(); ctx.moveTo(x, e.y + e.h); ctx.lineTo(x + e.w / 6, e.y + 4); ctx.lineTo(x + e.w / 3, e.y + e.h); ctx.fill(); }
      } else if (e.type === "goal") {
        ctx.fillStyle = "#fff"; ctx.fillRect(e.x + 8, e.y - 20, 5, e.h + 20);
        ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.moveTo(e.x + 13, e.y - 20); ctx.lineTo(e.x + 13 + 36 + Math.sin(e.t * 5) * 4, e.y - 6); ctx.lineTo(e.x + 13, e.y + 8); ctx.fill();
      } else if (e.type === "powerup") {
        ctx.fillStyle = "#A8F03A"; ctx.shadowColor = "#A8F03A"; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 7); ctx.fill();
      } else if (e.type === "checkpoint") {
        ctx.fillStyle = "#29D8F5"; ctx.fillRect(e.x + e.w / 2 - 2, e.y, 4, e.h);
      }
      ctx.restore();
    }

    function drawPlayer(ctx, imgs) {
      const p = state.player;
      if (invuln > 0 && Math.floor(invuln * 12) % 2 === 0) return;
      const cx = p.x + P.w / 2, feet = state.gravity > 0 ? p.y + P.h : p.y;
      const sy = squash, sx = 1 / Math.sqrt(squash);
      const img = imgs.hero || imgs.player;
      ctx.save();
      ctx.translate(cx, feet);
      if (state.gravity < 0) ctx.scale(1, -1);
      ctx.scale(sx, sy);
      if (powers.shield) { ctx.strokeStyle = "rgba(41,216,245,.8)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -P.drawH / 2, P.drawW * 0.62, 0, 7); ctx.stroke(); }
      if (img) {
        ctx.scale(p.facing < 0 ? -1 : 1, 1);
        ctx.drawImage(img, -P.drawW / 2, -P.drawH, P.drawW, P.drawH);
      } else {
        ctx.fillStyle = pal.player; roundRect(ctx, -P.w / 2, -P.h, P.w, P.h, 12); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(-8 + p.facing * 5, -P.h + 12, 6, 12); ctx.fillRect(4 + p.facing * 5, -P.h + 12, 6, 12);
      }
      ctx.restore();
    }

    function drawHud(ctx) {
      text(ctx, "★ " + state.score, 24, 30, 26, pal.hud);
      let hearts = "";
      for (let i = 0; i < Math.max(0, state.lives); i++) hearts += "♥";
      text(ctx, hearts, 24, 64, 24, "#FF5A6E");
      const name = levels[state.level].name || "Level " + (state.level + 1);
      text(ctx, name, W - 24, 30, 20, "rgba(255,255,255,.85)", "right", 700);
      const pw = Object.keys(powers).filter((k) => powers[k]);
      if (pw.length) text(ctx, pw.join(" · "), W - 24, 60, 16, "#A8F03A", "right", 700);
      if (state.status === "levelComplete") banner(ctx, "Level clear!", "Get ready…", "#A8F03A");
      if (state.status === "won") banner(ctx, cfg.winText || "You win!", "Score " + state.score + " · press R to play again", "#FFC83D");
      if (state.status === "lost") banner(ctx, cfg.loseText || "Game over", "Press R to try again", "#FF5A6E");
    }
    function banner(ctx, title, sub, col) {
      const k = Math.min(1, endTimer * 3);
      ctx.save();
      ctx.fillStyle = "rgba(7,9,26," + 0.55 * k + ")"; ctx.fillRect(0, 0, W, H);
      ctx.translate(W / 2, H / 2 - 20); const s = 0.6 + 0.4 * k + Math.sin(Math.min(1, endTimer * 2) * Math.PI) * 0.08; ctx.scale(s, s);
      text(ctx, title, 0, 0, 64, col, "center");
      text(ctx, sub, 0, 60, 22, "#fff", "center", 600);
      ctx.restore();
    }

    function draw(g, ctx) {
      const imgs = g.images;
      ctx.save();
      drawBackground(ctx, imgs);
      let sx = 0, sy = 0;
      if (shakeT > 0) { sx = rand(-1, 1) * shakeMag; sy = rand(-1, 1) * shakeMag; }
      ctx.translate(Math.round(-cam.x + sx), Math.round(-cam.y + sy));
      drawTiles(ctx, imgs);
      for (const e of entities) drawEntity(ctx, e, imgs);
      drawPlayer(ctx, imgs);
      for (const q of particles) {
        ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color;
        if (q.rect) ctx.fillRect(q.x, q.y, q.size, q.size * 0.6); else { ctx.beginPath(); ctx.arc(q.x, q.y, q.size / 2, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      for (const f of floaters) { ctx.globalAlpha = clamp(f.life * 2, 0, 1); text(ctx, f.s, f.x, f.y, 18, f.color, "center"); }
      ctx.globalAlpha = 1;
      ctx.restore();
      lighting.draw(ctx, cam, [{ x: state.player.x + P.w / 2, y: state.player.y + P.h / 2, r: lighting.radius * (powers.light ? 1.6 : 1) }]
        .concat(entities.filter((e) => e.light).map((e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2, r: e.light }))), state.time);
      if (hooks.onDraw) { ctx.save(); try { hooks.onDraw(ctx, api); } catch (err) { reportError(err); } ctx.restore(); }
      drawHud(ctx);
    }

    function reportError(err) {
      // Surface hook errors to the harness without killing the loop on every frame.
      if (!reportError.seen) { reportError.seen = true; setTimeout(() => { throw err; }); }
    }

    /* ----- public api handed to hooks and custom entities */
    const api = {
      state, TILE, W, H, input, sfx: SFX, palette: pal,
      get entities() { return entities; },
      get player() { return state.player; },
      get camera() { return cam; },
      get powers() { return powers; },
      get images() { return game ? game.images : {}; },
      addScore, hurt, win, lose, shake, burst, confetti, floatText,
      setPower(name, on = true) { powers[name] = on; },
      spawn(ch, col, row) {
        const def = legend[ch]; if (!def) return null;
        const size = def.size || 34;
        const e = Object.assign({}, def, { ch, x: col * TILE + (TILE - size) / 2, y: row * TILE + TILE - size, w: size, h: size, x0: col * TILE, y0: row * TILE + TILE - size, dir: -1, alive: true, t: 0 });
        entities.push(e); return e;
      },
      tileAt, solidAt, restart: reset,
      get level() { return levels[state.level]; },
    };

    game = createGame({
      width: W, height: H, assets: cfg.assets,
      init: () => { reset(); hooks.onStart && hooks.onStart(api); },
      update, draw,
    });
    window.__siwi = { state, api, game, version: Siwi.version, restart: reset };
    return api;
  }

  /* ------------------------------------------------------------------ lighting (spooky / night games) */
  // config.darkness 0..0.95 (0 = off), config.light = radius in px around the hero.
  function makeLighting(cfg) {
    const darkness = clamp(+cfg.darkness || 0, 0, 0.95);
    const radius = clamp(+cfg.light || 170, 60, 600);
    let layer = null;
    return {
      radius, darkness,
      draw(ctx, cam, lights, t) {
        if (!darkness) return;
        if (!layer) { layer = document.createElement("canvas"); layer.width = W; layer.height = H; }
        const l = layer.getContext("2d");
        l.globalCompositeOperation = "source-over";
        l.clearRect(0, 0, W, H);
        l.fillStyle = "rgba(4,5,16," + darkness + ")";
        l.fillRect(0, 0, W, H);
        l.globalCompositeOperation = "destination-out";
        for (const s of lights) {
          const x = s.x - cam.x, y = s.y - cam.y;
          const r = s.r * (1 + Math.sin(t * 9 + s.x) * 0.025);
          if (x < -r || x > W + r || y < -r || y > H + r) continue;
          const g = l.createRadialGradient(x, y, r * 0.15, x, y, r);
          g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.6, "rgba(0,0,0,.75)"); g.addColorStop(1, "rgba(0,0,0,0)");
          l.fillStyle = g; l.beginPath(); l.arc(x, y, r, 0, 7); l.fill();
        }
        ctx.drawImage(layer, 0, 0);
        // warm tint inside the hero's light
        const h = lights[0];
        if (h) {
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(h.x - cam.x, h.y - cam.y, 0, h.x - cam.x, h.y - cam.y, h.r);
          g.addColorStop(0, "rgba(255,200,61,.10)"); g.addColorStop(1, "rgba(255,200,61,0)");
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
        }
      },
    };
  }

  /* ------------------------------------------------------------------ top-down explorer */
  const TD_LEGEND = {
    "#": { type: "solid" },
    "P": { type: "player" },
    "C": { type: "collectible", sprite: "collectible", value: 10 },
    "E": { type: "enemy", sprite: "enemy", speed: 70 },
    "F": { type: "enemy", sprite: "enemy2", speed: 55, chase: true, sight: 230 },
    "^": { type: "hazard", sprite: "hazard" },
    "G": { type: "goal", sprite: "goal" },
    "U": { type: "powerup", sprite: "powerup", power: "speed", label: "speed" },
    "K": { type: "key", sprite: "key" },
    "D": { type: "door", sprite: "door" },
    "L": { type: "lamp", sprite: "lamp", light: 150 },
  };
  const TD_PALETTE = {
    floor: "#2a2350", floorAlt: "#2f2858", wall: "#4b3d86", wallTop: "#8B6CFF",
    accent: "#FFC83D", hud: "#ffffff", hazard: "#FF5A6E", collectible: "#FFC83D", enemy: "#FF6FA5", player: "#29D8F5",
  };

  /**
   * Siwi.topdown(config): explore a maze seen from above; collect, avoid, find the exit.
   * config = { title, assets, palette, legend, levels:[{name, rows}], player:{speed,lives},
   *   darkness, light, action:"glow"|"dash"|"none", goalNeeds:"none"|"collectibles"|"keys", hooks }
   */
  function topdown(cfg) {
    setupTouch("topdown");
    const legend = Object.assign({}, TD_LEGEND, cfg.legend || {});
    const pal = Object.assign({}, TD_PALETTE, cfg.palette || {});
    const P = Object.assign({ speed: 220, w: 30, h: 30, drawW: 56, drawH: 56, lives: 3 }, cfg.player || {});
    const hooks = cfg.hooks || {};
    const action = cfg.action || (cfg.darkness ? "glow" : "dash");
    const goalNeeds = cfg.goalNeeds || "none";
    const lighting = makeLighting(cfg);
    const levels = (cfg.levels || []).filter((l) => l && Array.isArray(l.rows) && l.rows.length);
    if (!levels.length) throw new Error("siwi: config.levels is empty");

    const state = {
      player: { x: 0, y: 0, vx: 0, vy: 0, w: P.w, h: P.h, onGround: true, facing: 1 },
      score: 0, lives: P.lives, level: 0, levelCount: levels.length, status: "playing",
      frame: 0, time: 0, gravity: 1, events: [], mode: "topdown", keys: 0, collected: 0, toCollect: 0,
    };
    let grid = [], cols = 0, rows = 0, entities = [], particles = [], floaters = [];
    let spawn = { x: 0, y: 0 }, cam = { x: 0, y: 0 }, shakeT = 0, shakeMag = 0;
    let invuln = 0, powers = {}, endTimer = 0, cooldown = 0, glowT = 0, dashT = 0, walk = 0, hintT = 0, hintMsg = "";
    let game;

    function logEvent(kind, data) {
      state.events.push(Object.assign({ kind, t: +state.time.toFixed(2) }, data || {}));
      if (state.events.length > 60) state.events.shift();
    }

    function loadLevel(i) {
      const L = levels[i];
      rows = L.rows.length;
      cols = Math.max.apply(null, L.rows.map((r) => r.length));
      grid = []; entities = []; particles = []; floaters = [];
      spawn = { x: TILE * 1.5, y: TILE * 1.5 };
      for (let r = 0; r < rows; r++) {
        grid.push(new Array(cols).fill(null));
        for (let c = 0; c < cols; c++) {
          const ch = L.rows[r][c] || ".";
          const def = legend[ch];
          if (!def) continue;
          const x = c * TILE, y = r * TILE;
          if (def.type === "solid" || def.type === "door") grid[r][c] = Object.assign({ c, r }, def);
          else if (def.type === "player") spawn = { x: x + (TILE - P.w) / 2, y: y + (TILE - P.h) / 2 };
          else {
            const size = def.size || (def.type === "goal" ? 56 : def.type === "enemy" ? 40 : def.type === "lamp" ? 40 : 30);
            entities.push(Object.assign({}, def, {
              ch, x: x + (TILE - size) / 2, y: y + (TILE - size) / 2, w: size, h: size, x0: x, y0: y,
              dir: Math.random() < 0.5 ? -1 : 1, dx: 0, dy: 0, alive: true, t: Math.random() * 6, stun: 0, turnT: 0,
            }));
          }
        }
      }
      for (const e of entities) if (e.type === "enemy" && !e.chase) pickDir(e);
      state.level = i; state.status = "playing"; state.keys = 0; state.collected = 0;
      state.toCollect = entities.filter((e) => e.type === "collectible").length;
      endTimer = 0;
      respawn(true);
      logEvent("level_start", { level: i });
      hooks.onLevelStart && hooks.onLevelStart(api);
    }
    function respawn(full) {
      const p = state.player;
      p.x = spawn.x; p.y = spawn.y; p.vx = 0; p.vy = 0;
      if (!full) invuln = 1.5;
      cam.x = clamp(p.x - W / 2, 0, Math.max(0, cols * TILE - W)); cam.y = clamp(p.y - H / 2, 0, Math.max(0, rows * TILE - H));
    }
    let firstLoad = true;
    function reset() {
      state.score = 0; state.lives = P.lives; powers = {};
      const start = firstLoad ? clamp((window.SIWI_START_LEVEL | 0), 0, levels.length - 1) : 0;
      firstLoad = false;
      loadLevel(start);
    }

    function tileAt(c, r) {
      if (c < 0 || c >= cols || r < 0 || r >= rows) return legend["#"];
      return grid[r][c];
    }
    function solidAt(c, r) { const t = tileAt(c, r); return !!t && (t.type === "solid" || t.type === "door"); }
    function blocked(o) {
      const c0 = Math.floor(o.x / TILE), c1 = Math.floor((o.x + o.w - 1) / TILE);
      const r0 = Math.floor(o.y / TILE), r1 = Math.floor((o.y + o.h - 1) / TILE);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solidAt(c, r)) return tileAt(c, r);
      return null;
    }
    // Moves o by (dx, dy) one axis at a time; returns the tile that stopped it, if any.
    function move(o, dx, dy) {
      let hit = null;
      if (dx) { o.x += dx; const t = blocked(o); if (t) { hit = t; o.x = dx > 0 ? Math.floor((o.x + o.w) / TILE) * TILE - o.w - 0.01 : (Math.floor(o.x / TILE) + 1) * TILE + 0.01; } }
      if (dy) { o.y += dy; const t = blocked(o); if (t) { hit = t; o.y = dy > 0 ? Math.floor((o.y + o.h) / TILE) * TILE - o.h - 0.01 : (Math.floor(o.y / TILE) + 1) * TILE + 0.01; } }
      return hit;
    }
    function pickDir(e) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const d = dirs[Math.floor(Math.random() * 4)];
      e.dx = d[0]; e.dy = d[1]; e.turnT = rand(1.2, 3);
    }

    function burst(x, y, color, n = 14, speed = 200) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.8), max: 0.8, color, size: rand(3, 7) });
      }
    }
    function confetti(x, y) {
      const cs = ["#FF6FA5", "#8B6CFF", "#29D8F5", "#A8F03A", "#FFC83D", "#ffffff"];
      for (let i = 0; i < 80; i++) { const a = rand(0, 7), s = rand(150, 450); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(1, 1.6), max: 1.6, color: cs[i % 6], size: rand(4, 8), rect: true }); }
    }
    function shake(mag = 8, t = 0.25) { shakeMag = mag; shakeT = t; }
    function floatText(s, x, y, color) { floaters.push({ s, x, y, color: color || pal.accent, life: 1.1 }); }
    function hint(s) { hintMsg = s; hintT = 2.5; }
    function addScore(n, x, y) { state.score += n; if (x != null) floatText("+" + n, x, y); }

    function hurt() {
      if (invuln > 0 || state.status !== "playing") return;
      if (powers.shield) { powers.shield = false; invuln = 1; shake(5); SFX.stomp(); logEvent("shield_used"); return; }
      state.lives--;
      logEvent("hurt", { lives: state.lives });
      SFX.hurt(); shake(12, 0.35);
      burst(state.player.x + P.w / 2, state.player.y + P.h / 2, pal.hazard, 22, 260);
      hooks.onHurt && hooks.onHurt(api);
      if (state.lives <= 0) { state.status = "lost"; endTimer = 0; logEvent("lost"); SFX.lose(); return; }
      respawn(false);
    }
    function win() {
      if (state.status !== "playing") return;
      confetti(state.player.x + P.w / 2, state.player.y);
      SFX.win();
      if (state.level < levels.length - 1) { state.status = "levelComplete"; endTimer = 0; logEvent("level_complete", { level: state.level }); }
      else { state.status = "won"; endTimer = 0; logEvent("won", { score: state.score }); hooks.onWin && hooks.onWin(api); }
    }
    function goalOpen() {
      if (goalNeeds === "collectibles") return state.collected >= state.toCollect;
      if (goalNeeds === "keys") return !entities.some((e) => e.type === "key" && e.alive);
      return true;
    }
    function doAction() {
      const p = state.player, cx = p.x + P.w / 2, cy = p.y + P.h / 2;
      if (cooldown > 0) return;
      if (action === "glow") {
        cooldown = 2.2; glowT = 0.9;
        SFX.power(); burst(cx, cy, pal.accent, 26, 260);
        for (const e of entities) if (e.type === "enemy" && Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy) < 190) { e.stun = 2.5; floatText("shoo!", e.x + e.w / 2, e.y, "#A8F03A"); }
      } else if (action === "dash") {
        cooldown = 0.9; dashT = 0.18; invuln = Math.max(invuln, 0.25);
        SFX.jump(); burst(cx, cy, "rgba(255,255,255,.7)", 10, 120);
      }
      logEvent("action", { action });
      hooks.onAction && hooks.onAction(api);
    }

    function update(g, dt) {
      state.frame++; state.time += dt;
      if (shakeT > 0) shakeT -= dt;
      for (const q of particles) { q.life -= dt; q.vx *= 0.94; q.vy *= 0.94; q.x += q.vx * dt; q.y += q.vy * dt; }
      particles = particles.filter((q) => q.life > 0);
      for (const f of floaters) { f.life -= dt; f.y -= 40 * dt; }
      floaters = floaters.filter((f) => f.life > 0);
      if (hintT > 0) hintT -= dt;
      if (input.wasPressed("restart") && state.status !== "playing") { reset(); return; }
      if (state.status === "levelComplete") {
        endTimer += dt;
        if (endTimer > 1.6) { const sc = state.score, lv = state.lives; loadLevel(state.level + 1); state.score = sc; state.lives = lv; }
        return;
      }
      if (state.status !== "playing") { endTimer += dt; return; }

      const p = state.player;
      if (invuln > 0) invuln -= dt;
      if (cooldown > 0) cooldown -= dt;
      if (glowT > 0) glowT -= dt;
      if (dashT > 0) dashT -= dt;
      let ix = (input.isDown("right") ? 1 : 0) - (input.isDown("left") ? 1 : 0);
      let iy = (input.isDown("down") ? 1 : 0) - (input.isDown("up") || input.isDown("jump") ? 1 : 0);
      if (ix && iy) { ix *= 0.7071; iy *= 0.7071; }
      const speed = P.speed * (powers.speed ? 1.35 : 1) * (dashT > 0 ? 3 : 1);
      p.vx = lerp(p.vx, ix * speed, 0.3); p.vy = lerp(p.vy, iy * speed, 0.3);
      if (Math.abs(p.vx) < 2) p.vx = 0;
      if (Math.abs(p.vy) < 2) p.vy = 0;
      if (ix) p.facing = ix > 0 ? 1 : -1;
      if (ix || iy) walk += dt * 10;
      const hit = move(p, p.vx * dt, p.vy * dt);
      if (hit && hit.type === "door") {
        if (state.keys > 0) {
          state.keys--; grid[hit.r][hit.c] = null;
          SFX.power(); burst(hit.c * TILE + TILE / 2, hit.r * TILE + TILE / 2, pal.accent, 20, 200);
          floatText("door opened", hit.c * TILE + TILE / 2, hit.r * TILE, pal.accent); logEvent("door");
        } else if (hintT <= 0) hint("Locked. Find a key!");
      }
      if (input.wasPressed("action")) doAction();

      const pBox = { x: p.x, y: p.y, w: P.w, h: P.h };
      const pcx = p.x + P.w / 2, pcy = p.y + P.h / 2;
      for (const e of entities) {
        if (!e.alive) continue;
        e.t += dt;
        if (e.type === "enemy") {
          if (e.stun > 0) {
            e.stun -= dt;
            const ax = e.x + e.w / 2 - pcx, ay = e.y + e.h / 2 - pcy, d = Math.hypot(ax, ay) || 1;
            move(e, (ax / d) * 60 * dt, (ay / d) * 60 * dt);
          } else if (e.chase && Math.hypot(e.x + e.w / 2 - pcx, e.y + e.h / 2 - pcy) < (e.sight || 230)) {
            const ax = pcx - (e.x + e.w / 2), ay = pcy - (e.y + e.h / 2), d = Math.hypot(ax, ay) || 1;
            move(e, (ax / d) * e.speed * dt, (ay / d) * e.speed * dt);
            e.dir = ax > 0 ? 1 : -1;
          } else if (e.speed) {
            e.turnT -= dt;
            const t = move(e, e.dx * e.speed * dt * (e.chase ? 0.5 : 1), e.dy * e.speed * dt * (e.chase ? 0.5 : 1));
            if (t || e.turnT <= 0) pickDir(e);
            if (e.dx) e.dir = e.dx;
          }
        }
        if (e.type === "custom" && typeof e.update === "function") { try { e.update(e, api, dt); } catch (err) { reportError(err); } }
        if (!overlap(pBox, e)) continue;
        touch(e);
      }
      entities = entities.filter((e) => e.alive);

      const tx = clamp(pcx - W / 2, 0, Math.max(0, cols * TILE - W)), ty = clamp(pcy - H / 2, 0, Math.max(0, rows * TILE - H));
      cam.x = lerp(cam.x, tx, 0.14); cam.y = lerp(cam.y, ty, 0.14);
      if (hooks.onUpdate) { try { hooks.onUpdate(api, dt); } catch (err) { reportError(err); } }
    }

    function touch(e) {
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (e.type === "collectible") {
        e.alive = false; state.collected++;
        addScore(e.value || 10, cx, e.y);
        SFX.coin(); burst(cx, cy, pal.collectible, 12, 160);
        logEvent("collect", { score: state.score });
        hooks.onCollect && hooks.onCollect(e, api);
      } else if (e.type === "key") {
        e.alive = false; state.keys++;
        floatText("KEY!", cx, e.y, pal.accent); SFX.power(); burst(cx, cy, pal.accent, 18, 200);
        logEvent("key"); hooks.onCollect && hooks.onCollect(e, api);
      } else if (e.type === "powerup") {
        e.alive = false;
        powers[e.power || "speed"] = true;
        if (e.power === "extraLife") state.lives++;
        floatText((e.label || e.power || "power").toUpperCase() + "!", cx, e.y, "#A8F03A");
        SFX.power(); burst(cx, cy, "#A8F03A", 24, 220);
        logEvent("powerup", { power: e.power });
        hooks.onPowerup && hooks.onPowerup(e, api);
      } else if (e.type === "lamp") {
        if (!e.lit) { e.lit = true; spawn = { x: e.x0 + (TILE - P.w) / 2, y: e.y0 + (TILE - P.h) / 2 }; floatText("safe light", cx, e.y, "#29D8F5"); SFX.coin(); logEvent("checkpoint"); }
      } else if (e.type === "hazard") {
        hurt();
      } else if (e.type === "goal") {
        if (goalOpen()) win();
        else if (hintT <= 0) hint(goalNeeds === "keys" ? "Find every key first!" : "Collect everything first! " + state.collected + "/" + state.toCollect);
      } else if (e.type === "enemy") {
        if (e.stun <= 0) hurt();
      } else if (e.type === "custom" && typeof e.touch === "function") {
        try { e.touch(e, api); } catch (err) { reportError(err); }
      }
    }

    function drawFloorAndWalls(ctx, imgs) {
      const c0 = Math.max(0, Math.floor(cam.x / TILE)), c1 = Math.min(cols - 1, Math.ceil((cam.x + W) / TILE));
      const r0 = Math.max(0, Math.floor(cam.y / TILE)), r1 = Math.min(rows - 1, Math.ceil((cam.y + H) / TILE));
      const floor = imgs.floor, wall = imgs.tile;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const t = grid[r][c], x = c * TILE, y = r * TILE;
        if (!t) {
          if (floor) ctx.drawImage(floor, x, y, TILE, TILE);
          else { ctx.fillStyle = (r + c) % 2 ? pal.floor : pal.floorAlt; ctx.fillRect(x, y, TILE, TILE); }
          continue;
        }
        if (t.type === "door") {
          const img = imgs[t.sprite || "door"];
          if (floor) ctx.drawImage(floor, x, y, TILE, TILE); else { ctx.fillStyle = pal.floor; ctx.fillRect(x, y, TILE, TILE); }
          if (img) ctx.drawImage(img, x, y, TILE, TILE);
          else { ctx.fillStyle = "#7a4b2a"; roundRect(ctx, x + 4, y + 2, TILE - 8, TILE - 4, 6); ctx.fill(); ctx.fillStyle = pal.accent; ctx.fillRect(x + TILE / 2 - 4, y + TILE / 2 - 4, 8, 8); }
          continue;
        }
        const img = imgs[t.sprite || "tile"] || wall;
        if (img) { ctx.drawImage(img, x, y, TILE, TILE); }
        else {
          ctx.fillStyle = pal.wall; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = pal.wallTop; ctx.fillRect(x, y, TILE, 12);
          ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(x, y + TILE - 5, TILE, 5);
        }
        // soft shadow on the floor below a wall
        if (r + 1 < rows && !grid[r + 1][c]) { ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fillRect(x, y + TILE, TILE, 8); }
      }
    }

    function drawEntity(ctx, e, imgs) {
      if (e.type === "custom" && typeof e.draw === "function") { try { e.draw(ctx, e, api); } catch (err) { reportError(err); } return; }
      const img = imgs[e.sprite];
      const bob = e.type === "collectible" || e.type === "powerup" || e.type === "key" ? Math.sin(e.t * 4) * 3 : 0;
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + bob;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(cx, e.y + e.h + 2, e.w * 0.4, 6, 0, 0, 7); ctx.fill();
      if (e.type === "enemy" && e.stun > 0) ctx.globalAlpha = 0.45 + Math.sin(e.t * 20) * 0.1;
      if (e.type === "goal" && !goalOpen()) ctx.globalAlpha = 0.55;
      if (img) {
        const s = e.type === "goal" ? 1.3 : e.type === "enemy" ? 1.3 : 1.2;
        const wob = e.type === "enemy" ? 1 + Math.sin(e.t * 9) * 0.05 : 1;
        drawSprite(ctx, img, cx, cy, e.w * s, e.h * s, { flip: e.dir > 0, sy: wob });
      } else if (e.type === "collectible") {
        ctx.fillStyle = pal.collectible; ctx.shadowColor = pal.collectible; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx, cy + 11); ctx.lineTo(cx - 9, cy); ctx.closePath(); ctx.fill();
      } else if (e.type === "enemy") {
        ctx.fillStyle = pal.enemy; roundRect(ctx, e.x, e.y, e.w, e.h, 16); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(cx - 9, cy - 5, 6, 9); ctx.fillRect(cx + 3, cy - 5, 6, 9);
      } else if (e.type === "hazard") {
        ctx.fillStyle = pal.hazard; ctx.beginPath(); ctx.arc(cx, cy, e.w / 2, 0, 7); ctx.fill();
      } else if (e.type === "goal") {
        ctx.fillStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = 20; roundRect(ctx, e.x, e.y, e.w, e.h, 10); ctx.fill();
      } else if (e.type === "key") {
        ctx.strokeStyle = pal.accent; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx - 5, cy, 7, 0, 7); ctx.moveTo(cx + 2, cy); ctx.lineTo(cx + 14, cy); ctx.stroke();
      } else if (e.type === "lamp") {
        ctx.fillStyle = e.lit ? pal.accent : "#666"; ctx.shadowColor = pal.accent; ctx.shadowBlur = e.lit ? 24 : 0; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 7); ctx.fill();
      } else if (e.type === "powerup") {
        ctx.fillStyle = "#A8F03A"; ctx.shadowColor = "#A8F03A"; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, 7); ctx.fill();
      }
      ctx.restore();
    }

    function drawPlayer(ctx, imgs) {
      const p = state.player;
      if (invuln > 0 && Math.floor(invuln * 12) % 2 === 0) return;
      const cx = p.x + P.w / 2, feet = p.y + P.h;
      const moving = Math.abs(p.vx) + Math.abs(p.vy) > 20;
      const bounce = moving ? Math.abs(Math.sin(walk)) * 4 : 0;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(cx, feet + 2, P.w * 0.55, 7, 0, 0, 7); ctx.fill();
      ctx.translate(cx, feet - bounce);
      if (powers.shield) { ctx.strokeStyle = "rgba(41,216,245,.8)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -P.drawH / 2, P.drawW * 0.62, 0, 7); ctx.stroke(); }
      const img = imgs.hero || imgs.player;
      if (img) { ctx.scale(p.facing < 0 ? -1 : 1, 1); ctx.drawImage(img, -P.drawW / 2, -P.drawH, P.drawW, P.drawH); }
      else { ctx.fillStyle = pal.player; roundRect(ctx, -P.w / 2, -P.h - 8, P.w, P.h + 8, 12); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillRect(-8 + p.facing * 4, -P.h, 6, 10); ctx.fillRect(3 + p.facing * 4, -P.h, 6, 10); }
      ctx.restore();
    }

    function drawHud(ctx) {
      text(ctx, "★ " + state.score + (goalNeeds === "collectibles" ? "  (" + state.collected + "/" + state.toCollect + ")" : ""), 24, 30, 26, pal.hud);
      let hearts = ""; for (let i = 0; i < Math.max(0, state.lives); i++) hearts += "♥";
      text(ctx, hearts + (state.keys ? "   🔑×" + state.keys : ""), 24, 64, 24, "#FF5A6E");
      text(ctx, levels[state.level].name || "Level " + (state.level + 1), W - 24, 30, 20, "rgba(255,255,255,.85)", "right", 700);
      if (action !== "none") {
        const ready = cooldown <= 0;
        text(ctx, (action === "glow" ? "X: lantern glow" : "X: dash") + (ready ? "" : "…"), W - 24, 60, 16, ready ? "#A8F03A" : "rgba(255,255,255,.4)", "right", 700);
      }
      if (hintT > 0) text(ctx, hintMsg, W / 2, H - 40, 22, "#fff", "center", 700);
      if (state.status === "levelComplete") banner(ctx, "Level clear!", "Get ready…", "#A8F03A");
      if (state.status === "won") banner(ctx, cfg.winText || "You made it!", "Score " + state.score + " · press R to play again", "#FFC83D");
      if (state.status === "lost") banner(ctx, cfg.loseText || "Game over", "Press R to try again", "#FF5A6E");
    }
    function banner(ctx, title, sub, col) {
      const k = Math.min(1, endTimer * 3);
      ctx.save();
      ctx.fillStyle = "rgba(7,9,26," + 0.55 * k + ")"; ctx.fillRect(0, 0, W, H);
      ctx.translate(W / 2, H / 2 - 20); const s = 0.6 + 0.4 * k; ctx.scale(s, s);
      text(ctx, title, 0, 0, 64, col, "center"); text(ctx, sub, 0, 60, 22, "#fff", "center", 600);
      ctx.restore();
    }

    function draw(g, ctx) {
      const imgs = g.images;
      ctx.fillStyle = pal.wall; ctx.fillRect(0, 0, W, H);
      ctx.save();
      let sx = 0, sy = 0;
      if (shakeT > 0) { sx = rand(-1, 1) * shakeMag; sy = rand(-1, 1) * shakeMag; }
      ctx.translate(Math.round(-cam.x + sx), Math.round(-cam.y + sy));
      drawFloorAndWalls(ctx, imgs);
      const sorted = entities.slice().sort((a, b) => a.y + a.h - (b.y + b.h));
      const py = state.player.y + P.h;
      let drawn = false;
      for (const e of sorted) { if (!drawn && e.y + e.h > py) { drawPlayer(ctx, imgs); drawn = true; } drawEntity(ctx, e, imgs); }
      if (!drawn) drawPlayer(ctx, imgs);
      for (const q of particles) {
        ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color;
        if (q.rect) ctx.fillRect(q.x, q.y, q.size, q.size * 0.6); else { ctx.beginPath(); ctx.arc(q.x, q.y, q.size / 2, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      for (const f of floaters) { ctx.globalAlpha = clamp(f.life * 2, 0, 1); text(ctx, f.s, f.x, f.y, 18, f.color, "center"); }
      ctx.globalAlpha = 1;
      ctx.restore();
      const p = state.player;
      const lights = [{ x: p.x + P.w / 2, y: p.y + P.h / 2, r: lighting.radius * (powers.light ? 1.6 : 1) * (glowT > 0 ? 1 + glowT : 1) }];
      for (const e of entities) {
        if (e.type === "lamp") lights.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, r: e.lit ? e.light || 150 : 50 });
        else if (e.type === "goal") lights.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, r: 90 });
        else if (e.type === "collectible" || e.type === "key") lights.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, r: 34 });
        else if (e.light) lights.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, r: e.light });
      }
      lighting.draw(ctx, cam, lights, state.time);
      if (hooks.onDraw) { ctx.save(); try { hooks.onDraw(ctx, api); } catch (err) { reportError(err); } ctx.restore(); }
      drawHud(ctx);
    }

    function reportError(err) {
      if (!reportError.seen) { reportError.seen = true; setTimeout(() => { throw err; }); }
    }

    const api = {
      state, TILE, W, H, input, sfx: SFX, palette: pal, mode: "topdown",
      get entities() { return entities; },
      get player() { return state.player; },
      get camera() { return cam; },
      get powers() { return powers; },
      get images() { return game ? game.images : {}; },
      addScore, hurt, win, lose: () => { state.status = "lost"; endTimer = 0; logEvent("lost"); SFX.lose(); }, shake, burst, confetti, floatText, hint,
      setPower(name, on = true) { powers[name] = on; },
      spawn(ch, col, row) {
        const def = legend[ch]; if (!def) return null;
        const size = def.size || 30;
        const e = Object.assign({}, def, { ch, x: col * TILE + (TILE - size) / 2, y: row * TILE + (TILE - size) / 2, w: size, h: size, x0: col * TILE, y0: row * TILE, dir: 1, dx: 0, dy: 0, alive: true, t: 0, stun: 0, turnT: 0 });
        entities.push(e); return e;
      },
      tileAt, solidAt, restart: reset,
      get level() { return levels[state.level]; },
    };

    game = createGame({ width: W, height: H, assets: cfg.assets, init: () => { reset(); hooks.onStart && hooks.onStart(api); }, update, draw });
    window.__siwi = { state, api, game, version: Siwi.version, restart: reset };
    return api;
  }

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

  const Siwi = { version: "1.1.0", W, H, TILE, input, audio, sfx: SFX, createGame, platformer, topdown, loadImages, drawSprite, text, clamp, lerp, rand };
  window.Siwi = Siwi;
})();
