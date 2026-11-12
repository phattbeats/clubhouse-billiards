// yarn build:clubhouse (or node build-clubhouse.mjs): the Clubhouse's copies of the engine and the game module.
//   dist-clubhouse/game.mjs    the server's game module (rules, bots, the physics), three.js bundled in
//   dist-clubhouse/engine.js   the same physics for the browser: three.js stays outside, loaded from the Clubhouse's own copy
//                              (../three.module.min.js next to the vendor folder), so the table and the guide share one three.js
//   dist-clubhouse/table.js    the three.js table (copied as is)
import { build } from "esbuild"
import { copyFileSync, mkdirSync } from "node:fs"
const common = { bundle: true, format: "esm", minify: false, logLevel: "info", define: { document: "undefined" } }
const threeOutside = { name: "three-outside", setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: "../three.module.min.js", external: true })) } }
mkdirSync("dist-clubhouse", { recursive: true })
await build({ ...common, platform: "node", entryPoints: ["src/clubhouse/game.ts"], outfile: "dist-clubhouse/game.mjs" })
await build({ ...common, platform: "browser", entryPoints: ["src/clubhouse/engine.ts"], outfile: "dist-clubhouse/engine.js", plugins: [threeOutside] })
copyFileSync("src/clubhouse/client/table.js", "dist-clubhouse/table.js")
