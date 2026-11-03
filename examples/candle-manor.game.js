// Example game 3: "Candle Manor" — a spooky-cozy top-down explorer with lantern light. Hand-written against siwi-kit.
// Used as a few-shot example for Spark (top-down genre) and as an offline fallback.
Siwi.topdown({
  title: "Candle Manor",
  assets: window.SIWI_ASSETS || {},
  palette: { floor: "#2b2240", floorAlt: "#30264a", wall: "#3d2f5c", wallTop: "#7a5fb0", accent: "#FFC83D", collectible: "#FFE08A", enemy: "#9fd8ff", player: "#FF9F6B" },
  darkness: 0.88,
  light: 170,
  action: "glow",
  goalNeeds: "keys",
  legend: {
    "C": { type: "collectible", sprite: "page", value: 10 },
    "E": { type: "enemy", sprite: "dustbunny", speed: 60 },
    "F": { type: "enemy", sprite: "ghost", speed: 50, chase: true, sight: 220 },
    "K": { type: "key", sprite: "key" },
    "D": { type: "door", sprite: "door" },
    "L": { type: "lamp", sprite: "lamp", light: 160 },
    "U": { type: "powerup", sprite: "oil", power: "light", label: "brighter lantern" },
  },
  player: { speed: 210, lives: 3 },
  winText: "The manor is glowing again!",
  levels: [
    {
      name: "The Long Hall",
      rows: [
        "##############################",
        "#P..C....#.......C......#....#",
        "#........#..####....E...#..C.#",
        "#..L.....#..#..#........D....#",
        "#....C......#K.#...C....#..G.#",
        "#######..####..####.....######",
        "#.....C.....C.....#.....#....#",
        "#..E......F.......#..L..#..C.#",
        "#.........#####...#.....#....#",
        "#..C..U...#...#.....C.......F#",
        "#.........#.C.#...#.....#....#",
        "##############################",
      ],
    },
    {
      name: "Attic of Whispers",
      rows: [
        "################################",
        "#P....#.....C.....#......C.....#",
        "#.....#..F........#..####......#",
        "#..C..#.....####.....#K.#...E..#",
        "#...........#..#.....#..#......#",
        "##.####..C..#K.#..L..#..####.###",
        "#.......E......#...........C...#",
        "#..L........####...F...........#",
        "#....######......####D####.....#",
        "#.C..#....#..C...#.......#..U..#",
        "#....#.C.........#...G...#.....#",
        "#....#....#...F..#.......#..C..#",
        "################################",
      ],
    },
  ],
  hooks: {
    onDraw(ctx, api) {
      if (api.state.time < 5 && api.state.level === 0) Siwi.text(ctx, "Find the key, open the door, reach the window. X = lantern glow", api.W / 2, api.H - 70, 20, "#fff", "center");
    },
  },
});
