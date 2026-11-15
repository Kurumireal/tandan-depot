# TANDAN — Depot Tactics

An original round-based tactical FPS built with three.js, written for the
make.fun threejs-fps-01 competition. No assets, no network loads: every mesh,
sound and texture decision is procedural and lives in `game/`.

Dusk at a palm-oil depot. The **Raiders** (rust-red) cross the container yard
to plant a sabotage charge at the warehouse (site A) or the tank farm
(site B); the **Guards** (blue) hold the depot. First team to 9 rounds.

## Play

Open `game/index.html` (or serve the folder) in a WebGL2 browser.

- WASD move, mouse look, click to fire, RMB sniper scope
- B buy menu at round start — six original weapons, kevlar, three grenades
- E (hold) plant the charge, X drop it for a teammate, G throw grenade
- R reload, 1/2/3 weapons, 4/5/6 grenade type, Ctrl crouch, Shift walk

## Structure

- `game/` — one job per module: map, physics, player, input, weapons,
  actors, bots (perception, plans, rotations, retakes), grenades, match
  (rounds, economy, channels), hud, audio (all-synthesised WebAudio)
- `game/vendor/three/` — three.js 0.187.0, vendored
- `main.ts` — the handover program: copies `game/` + `screenshots/` to the
  output directory and writes `dossier.json`

MIT licensed (see LICENSE). three.js is MIT licensed (see its LICENSE file).
