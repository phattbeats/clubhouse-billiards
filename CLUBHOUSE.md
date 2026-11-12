# Clubhouse integration

This fork of [tailuge/billiards](https://github.com/tailuge/billiards) (GPL-3.0, by tailuge) adds `src/clubhouse/`, the Nine-Ball table
game used by the PHATT Clubhouse. Everything upstream is untouched and the license and credits stay as they are.

| File | What it is |
|---|---|
| `src/clubhouse/engine.ts` | Headless wrapper around the upstream physics (`Table`, `Ball`, cushions, jaws, pockets) set up as a WPA 9-foot table with 2 1/4 in, 6 oz balls and Alciatore's cloth constants. Adds squirt, the miscue zone and cue elevation (swerve, masse) at the strike; the 8-ball, 9-ball and Cutthroat racks; `simulate()` returns a replay of per-ball segments carrying position and spin; `report()` reads first contact, cushions, pots with their pocket, banks, combos and kicks. Skips idle ball pairs (same pairs, same order, same results). |
| `src/clubhouse/game.ts` | 8-ball (WPA, call-shot), 9-ball (push-out, three fouls) and Cutthroat as a table-game module, with doubles at 4 seats: rules (`judge`), validation, decisions (illegal break, the 8 on the break, push-out), flags for achievements, and bots that rank pots by ghost-ball geometry, roll the best few on the engine and score the position they leave, play safe or kick when there is nothing. |
| `src/clubhouse/client/table.js` | The three.js table: replays with spin, pull-back stroke, aim, ball in hand, spin dial with the miscue ring and cue elevation, called pocket, short and full guides (the full one rolls the shot in the browser with `engine.js`), decisions, banners and sounds, three cameras, portrait/phone layout. |
| `build-clubhouse.mjs` | `node build-clubhouse.mjs` bundles `dist-clubhouse/game.mjs` (server, three.js inside), `dist-clubhouse/engine.js` (browser, three.js outside) and copies `table.js`. |

The Clubhouse keeps `game.mjs`, `engine.js` and `table.js` (plus this license and a NOTICE) in its own `client/vendor/billiards/`, and nothing else
of the Clubhouse is part of this repository. The server rolls every shot, so all screens see the same replay.
