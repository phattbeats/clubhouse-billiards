import { build } from "esbuild"
const common = { entryPoints: ["src/clubhouse/engine.ts"], bundle: true, format: "esm", minify: false, logLevel: "info" }
await build({ ...common, platform: "node", outfile: "dist-clubhouse/engine.mjs", define: { document: "undefined" } })
