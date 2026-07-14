// Headless regression-suite runner.
//
// Runs every guard in tests/ (determinism baselines, replay round-trips, rank sweeps,
// save-logic units, SFX/sprite wiring checks) under tsx with the asset shim, after a
// whole-project typecheck. Each guard is a standalone script that exits non-zero on
// failure; render/GL behavior is out of scope here and only validates in a live browser.
//
// Usage:
//   node tests/run.mjs              # typecheck + all guards
//   node tests/run.mjs image boss   # only guards whose filename matches a filter (skips typecheck)
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const filters = process.argv.slice(2);

const all = readdirSync(here).filter((f) => f.endsWith(".ts")).sort();
const picked = filters.length ? all.filter((f) => filters.some((s) => f.includes(s))) : all;
if (picked.length === 0) {
  console.error(`no tests match: ${filters.join(" ")}`);
  process.exit(1);
}

if (filters.length === 0) {
  const tsc = spawnSync("pnpm", ["exec", "tsc", "-p", resolve(here, "tsconfig.json"), "--noEmit"], {
    stdio: "inherit",
    cwd: root,
  });
  if (tsc.status !== 0) {
    console.error("✗ typecheck failed");
    process.exit(1);
  }
  console.log("✓ typecheck (src + games + tests)");
}

const failures = [];
const t0 = Date.now();
for (const f of picked) {
  const started = Date.now();
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", resolve(here, "helpers/asset-shim.mjs"), resolve(here, f)],
    { stdio: "inherit", cwd: root },
  );
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`✓ ${f} (${secs}s)`);
  } else {
    console.error(`✗ ${f} exited ${r.status ?? "signal"} (${secs}s)`);
    failures.push(f);
  }
}

const total = ((Date.now() - t0) / 1000).toFixed(1);
if (failures.length) {
  console.error(`\n${failures.length}/${picked.length} FAILED in ${total}s: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\nall ${picked.length} guards passed in ${total}s`);
