# Clubhouse integration

This fork of [tailuge/billiards](https://github.com/tailuge/billiards) (GPL-3.0, by tailuge) adds `src/clubhouse/`, the Nine-Ball table
game used by the PHATT Clubhouse. Everything upstream is untouched and the license and credits stay as they are.

| File | What it is |
|---|---|
| `src/clubhouse/engine.ts` | Headless wrapper around the upstream physics (`Table`, `Ball`, cushions, pockets): rack, `simulate()` returns a replay, `summarise()` reports first contact/cushions/pockets, `aimAt()` uses upstream's `AimCalculator`. The engine's rare "depth exceeded" throw is retried a hair to one side. |
| `src/clubhouse/game.ts` | Nine-Ball (rotation) as a table-game module: rules, shot validation, bots that pick the line with `AimCalculator` and the shot with the best result on the real engine. |
| `src/clubhouse/client/table.js` | The three.js table: aim, cue ball in hand, spin, power, replays of the server's shots, three cameras, portrait/phone layout. |
| `build-clubhouse.mjs` | `yarn build:clubhouse` bundles `engine.mjs` and `game.mjs` into `dist-clubhouse/` with esbuild. |

The Clubhouse keeps `game.mjs` and `table.js` (plus this license and a NOTICE) in its own `client/vendor/billiards/`, and nothing else
of the Clubhouse is part of this repository. The server rolls every shot, so all screens see the same replay.
