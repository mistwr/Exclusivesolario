import { build } from "esbuild";

await build({
  entryPoints: ["src/identity.js"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  outfile: "dist/gestao/identity.bundle.js",
  sourcemap: false,
  minify: true
});
