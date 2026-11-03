# siwi-kit reference (what game.js runs on)

The page already loaded `siwi-kit.js`. It defines `window.Siwi`. Art is in `window.SIWI_ASSETS` (name -> data URI).
A game is ONE call: `Siwi.platformer(config)`. Never write your own game loop, canvas setup, input handling, physics or collision. Never use `fetch`, `import`, `eval`, `localStorage`, external URLs, or DOM elements other than what the kit creates. Plain ES2020, no TypeScript.

## config
```js
Siwi.platformer({
  title: "Name",
  assets: window.SIWI_ASSETS || {},          // always exactly this
  palette: { sky, skyBottom, ground, groundTop, accent, collectible, enemy, hazard, player }, // hex colors, used when art is missing
  player: { speed: 260, jump: 640, lives: 3, doubleJump: false }, // speed 200-320, jump 560-720
  gravity: 1800,                             // optional, 1400-2200
  gravityFlip: false,                        // true: X/Shift flips gravity while grounded
  winText: "You did it!", loseText: "Try again",
  legend: { /* char -> entity definition, merged over the defaults below */ },
  levels: [ { name: "Level name", rows: [ "....", ... ], background: "background" } ],
  hooks: { onStart(api), onUpdate(api, dt), onDraw(ctx, api), onCollect(item, api), onStomp(enemy, api),
           onPowerup(item, api), onHurt(api), onLevelStart(api), onWin(api) },
});
```

## level grid
- Tile = 48 px. Screen = 960x540 (20 x 11.25 tiles). Camera follows the player horizontally and vertically.
- Each level: 11 to 13 rows, 60 to 110 columns. **All rows in a level must have the same length.**
- Exactly one `P` (player start) and exactly one `G` (goal) per level. The goal is at the far right end.
- Bottom 2 rows are mostly ground (`#`). Gaps in the ground are at most 3 tiles wide. Put `^` hazards only in the bottom of gaps or on the ground, never blocking the only path.
- A jump clears about 2 tiles up and 4 tiles across. Every platform needed to progress must be reachable.
- Entities stand on the row above ground. Leave the first 6 columns around `P` free of enemies and hazards.

## default legend (override or add characters in `legend`)
| char | definition |
|---|---|
| `#` | `{type:"solid"}` ground, drawn with the `tile` sprite |
| `=` | `{type:"solid", sprite:"platform"}` |
| `-` | `{type:"oneway", sprite:"platform"}` jump-through platform |
| `P` | player start |
| `C` | `{type:"collectible", sprite:"collectible", value:10}` |
| `E` | `{type:"enemy", sprite:"enemy", speed:70, stompable:true}` walks, turns at walls and ledges |
| `F` | `{type:"enemy", sprite:"enemy2", speed:0, flying:true, amplitude:60, stompable:true}` bobs up and down |
| `^` | `{type:"hazard", sprite:"hazard"}` |
| `G` | `{type:"goal", sprite:"goal"}` |
| `U` | `{type:"powerup", sprite:"powerup", power:"doubleJump", label:"double jump"}` |
| `K` | `{type:"checkpoint"}` |

- Entity fields: `type`, `sprite` (asset name), `size` (px, default 34; enemies 44; goal 64), `value` (score), `speed`, `stompable`, `flying`, `amplitude`, `power` (`doubleJump` | `speed` | `superJump` | `shield` | `extraLife`), `label`.
- Custom entity: `{ type:"custom", sprite, size, update(e, api, dt), touch(e, api), draw(ctx, e, api) }`. Use it for ONE special mechanic (bounce pad, moving platform look-alike, wind gust, key that opens the goal...). Entity has `x, y, w, h, x0, y0, t, alive, dir`. Set `e.alive = false` to remove it. `draw` is optional: without it the sprite is drawn.

## api (passed to hooks and custom entities)
`api.state` ({score, lives, level, status: "playing"|"levelComplete"|"won"|"lost", gravity, frame, time}),
`api.player` ({x, y, vx, vy, onGround, facing}), `api.entities`, `api.powers`, `api.images`, `api.TILE`, `api.W`, `api.H`, `api.camera` ({x, y}),
`api.addScore(n, x, y)`, `api.hurt()`, `api.win()`, `api.lose()`, `api.shake(mag, t)`, `api.burst(x, y, color, n, speed)`, `api.confetti(x, y)`,
`api.floatText(text, x, y, color)`, `api.setPower(name, on)`, `api.spawn(char, col, row)`, `api.tileAt(col, row)`, `api.solidAt(col, row)`,
`api.sfx.jump() / coin() / stomp() / hurt() / power() / win() / lose() / flip()`.
`onDraw(ctx, api)` draws in SCREEN space after the world (HUD extras). Text helper: `Siwi.text(ctx, str, x, y, size, color, align)`.

## sprites
Sprite names you may reference: `hero`, `tile`, `platform`, `collectible`, `enemy`, `enemy2`, `hazard`, `goal`, `powerup`, `background`, plus up to 2 extra names declared in the design. A missing sprite falls back to a colored shape, so the game always works without art.

## controls (built in)
Arrows/WASD move, Space/Up jump, X/Shift action, R restart, P pause.
