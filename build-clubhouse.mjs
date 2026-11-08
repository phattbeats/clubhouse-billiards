import { build } from "esbuild"
const common = { bundle: true, format: "esm", minify: false, logLevel: "info", platform: "node", define: { document: "undefined" } }
await build({ ...common, entryPoints: ["src/clubhouse/engine.ts"], outfile: "dist-clubhouse/engine.mjs" })
await build({ ...common, entryPoints: ["src/clubhouse/game.ts"], outfile: "dist-clubhouse/game.mjs" })
