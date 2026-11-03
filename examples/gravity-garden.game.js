// Example game 2: "Gravity Garden" — flip gravity (X / Shift) to walk on the ceiling.
// Shows gravityFlip, a custom entity (a bouncy mushroom) and an onUpdate hook.
Siwi.platformer({
  title: "Gravity Garden",
  assets: window.SIWI_ASSETS || {},
  palette: { sky: "#1d1446", skyBottom: "#0B1030", ground: "#2b2459", groundTop: "#29D8F5", collectible: "#A8F03A", enemy: "#FF6FA5", player: "#FFC83D" },
  gravityFlip: true,
  legend: {
    "C": { type: "collectible", sprite: "seed", value: 10 },
    "E": { type: "enemy", sprite: "bug", speed: 60, stompable: true },
    "M": {
      type: "custom", sprite: "mushroom", size: 40,
      touch(e, api) {
        const p = api.player;
        if (p.vy * api.state.gravity > 0) { p.vy = -1000 * api.state.gravity; api.sfx.jump(); api.burst(e.x + 20, e.y, "#FF6FA5", 10, 160); }
      },
      draw(ctx, e, api) {
        const img = api.images.mushroom;
        if (img) { ctx.drawImage(img, e.x - 4, e.y - 8, 48, 48); return; }
        ctx.fillStyle = "#FF6FA5"; ctx.beginPath(); ctx.arc(e.x + 20, e.y + 22, 20, Math.PI, 0); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(e.x + 14, e.y + 22, 12, 18);
      },
    },
  },
  player: { speed: 250, jump: 600, lives: 3 },
  levels: [
    {
      name: "Upside Garden",
      rows: [
        "##################################################",
        "##################################################",
        "........C.C.C.............C.C.C...................",
        "...........................................C.C....",
        "..................................................",
        "..................................................",
        "...............................E..............G...",
        "...P........M..........C.C........................",
        "##########.....#########...#########.....#########",
        "##########^^^^^#########^^^#########^^^^^#########",
        "##################################################",
      ],
    },
  ],
  hooks: {
    onUpdate(api) {
      // Bonus: standing on the ceiling slowly earns points.
      if (api.state.gravity < 0 && api.player.onGround && api.state.frame % 30 === 0) api.addScore(1);
    },
  },
});
