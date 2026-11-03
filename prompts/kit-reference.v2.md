# siwi-kit reference (what game.js runs on)

The page already loaded `siwi-kit.js`. It defines `window.Siwi`. Art is in `window.SIWI_ASSETS` (name -> data URI).
A game is ONE call: `Siwi.platformer(config)` (side view) or `Siwi.topdown(config)` (seen from above). Never write your own game loop, canvas setup, input handling, physics or collision. Never use `fetch`, `import`, `eval`, `localStorage`, external URLs, or DOM elements other than what the kit creates. Plain ES2020, no TypeScript.

## config
```js
Siwi.platformer({
  title: "Name",
  assets: window.SIWI_ASSETS || {},          // always exactly this
  palette: { sky, skyBottom, ground, groundTop, accent, collectible, enemy, hazard, player }, // hex colors, used when art is missing
  player: { speed: 260, jump: 640, lives: 3, doubleJump: false }, // speed 200-320, jump 560-720
  gravity: 1800,                             // optional, 1400-2200
  gravityFlip: false,                        // true: X/Shift flips gravity while grounded
  darkness: 0,                               // 0 = off; 0.55 dusk; 0.85-0.9 dark (only the hero's light shows the world)
  light: 170,                                // light radius around the hero in px when darkness is on; entities with a "light" field glow too
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
Sprite names you may reference: `hero`, `tile`, `platform`, `floor`, `collectible`, `enemy`, `enemy2`, `hazard`, `goal`, `powerup`, `key`, `door`, `lamp`, `background`, plus extra names declared in the design. A missing sprite falls back to a colored shape, so the game always works without art.

## controls (built in)
Platformer: Arrows/WASD move, Space/Up jump, X/Shift action, R restart, P pause.
Top-down: Arrows/WASD move in 4 directions, X/Shift/Space action, R restart, P pause.

# Siwi.topdown(config): explore from above
```js
Siwi.topdown({
  title: "Name",
  assets: window.SIWI_ASSETS || {},
  palette: { floor, floorAlt, wall, wallTop, accent, collectible, enemy, hazard, player }, // used when art is missing
  player: { speed: 210, lives: 3 },          // speed 170-260
  darkness: 0.88, light: 170,                // same as platformer; dark games feel spooky
  action: "glow",                            // "glow": X makes the lantern flare and shoos nearby critters for 2.5s (2.2s cooldown)
                                             // "dash": X dashes forward briefly; "none"
  goalNeeds: "keys",                         // "none" | "keys" (every key picked up) | "collectibles" (all collected)
  winText, loseText, legend: {...}, levels: [ { name, rows: [...] } ],
  hooks: { onStart, onUpdate, onDraw, onCollect(item, api), onPowerup, onHurt, onLevelStart, onWin, onAction(api) },
});
```
- Tile = 48 px. Levels 11 to 16 rows, 26 to 40 columns, all rows the same length, the border is all `#`. The camera follows the hero.
- Hero walks in 4 directions; walls and closed doors block. Critters hurt on touch (unless shooed). No jumping, no gravity.
- Default top-down legend:

| char | definition |
|---|---|
| `#` | `{type:"solid"}` wall, drawn with the `tile` sprite (floor uses the `floor` sprite) |
| `P` | player start |
| `C` | `{type:"collectible", sprite:"collectible", value:10}` |
| `E` | `{type:"enemy", sprite:"enemy", speed:70}` wanders, turns at walls |
| `F` | `{type:"enemy", sprite:"enemy2", speed:55, chase:true, sight:230}` drifts toward the hero when close |
| `^` | `{type:"hazard", sprite:"hazard"}` |
| `G` | `{type:"goal", sprite:"goal"}` exit; locked until `goalNeeds` is met |
| `U` | `{type:"powerup", sprite:"powerup", power:"speed", label:"speed"}` powers: `speed`, `light` (bigger lantern), `shield`, `extraLife` |
| `K` | `{type:"key", sprite:"key"}` |
| `D` | `{type:"door", sprite:"door"}` blocks until the hero walks into it holding a key (uses the key) |
| `L` | `{type:"lamp", sprite:"lamp", light:150}` lights up when touched and becomes the respawn point |

- `api` is the same as the platformer's, plus `api.state.keys`, `api.state.collected`, `api.state.toCollect`, and `api.hint(text)` (shows a short message at the bottom). Entities also have `stun` (seconds shooed).
