import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => resolve(root, "src", p);

// `higan*` aliases mirror the subpaths the engine will expose once it's published as
// an npm package, so the reference game already imports the engine by package name
// instead of deep `../../src/...` paths. When the engine is later extracted to a real
// package, these import statements don't change — only the resolution flips from source
// to node_modules, and a `package.json` `exports` map replaces this alias block.
//
//   higan          → the authoring API (the runtime vocabulary content is written against)
//   higan/app      → the app shell (runGame / HMR wiring) a game's bootstrap runs over
//   higan/testing  → the determinism self-test harness (dev-only guards)
//
// Order matters: the bare `higan` find also matches `higan/...`, so the specific
// subpaths must come first or they'd resolve through `higan` to the wrong directory.
const alias = [
  { find: "higan/app", replacement: src("app") },
  { find: "higan/testing", replacement: src("testing") },
  { find: "higan", replacement: src("api") },
];

export default defineConfig({
  // Relative base so the build works from any subpath without hardcoding it. The deploy
  // workflow nests this output under `/<repo>/demo/` on GitHub Pages (root reserved for
  // docs later), and relative asset URLs resolve correctly from there with no rebuild —
  // and survive a repo rename. The router is in-memory screens, not URL routing, so no
  // SPA 404 fallback is needed.
  base: "./",
  resolve: { alias },
});
