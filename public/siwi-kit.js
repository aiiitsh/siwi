/*!
 * siwi-kit.js — the hand-written engine every Siwi game runs on.
 * Plain JS, no dependencies. Canvas 960x540, fixed 60 Hz timestep.
 *
 * Two layers:
 *   Siwi.createGame({ width, height, assets, init, update, draw })  low-level loop
 *   Siwi.platformer(config)                                         data-driven platformer (what generated games use)
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
    ArrowUp: "jump", w: "jump", W: "jump", " ": "jump", Space: "jump",
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
      frame: 0, time: 0, gravity: 1, events: [],
    };
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
      if (input.wasPressed("jump")) jumpBuffer = 0.12;
      if (jumpBuffer > 0) { jumpBuffer -= dt; if (tryJump()) jumpBuffer = 0; }
      // variable jump height
      if (!input.isDown("jump") && p.vy * state.gravity < -200) p.vy *= 0.85;

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
        if (spawn.x !== e.x0) { spawn = { x: e.x0 + (TILE - P.w) / 2, y: e.y0 + e.h - P.h }; floatText("CHECKPOINT", cx, e.y, "#29D8F5"); SFX.coin(); logEvent("checkpoint"); }
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
      if (hooks.onDraw) { try { hooks.onDraw(ctx, api); } catch (err) { reportError(err); } }
      ctx.restore();
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

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

  const Siwi = { version: "1.0.0", W, H, TILE, input, audio, sfx: SFX, createGame, platformer, loadImages, drawSprite, text, clamp, lerp, rand };
  window.Siwi = Siwi;
})();
