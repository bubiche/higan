// Rank sweep — Stage 3 content RUNS at all four difficulty ranks.
//
// `campaign-three-stage.ts` proved the full 1→2→3 spine, but only at Easy; `main.ts`'s boot guard runs
// Normal, but only in a live DEV browser. So Hard and Lunatic had executed NOWHERE for Stage 3,
// and the "scale() ≥ 1 at Easy" arithmetic only rules out the THINNEST rank going to zero. This
// closes that gap the same way the Stage 2 sweep does: it steps Stage 3's scene (its own
// waves/midboss and its MOVING final boss, incl. the `delay` and `ramp` legs) at
// Easy/Normal/Hard/Lunatic and asserts each is (a) reproducible A==B, (b) a distinct trajectory,
// and (c) denser than the rank below. A throw at any rank crashes the harness — the no-throw
// check. Stage 3 balance is iterative, not gated, so no specific hash is frozen.

import { checkDeterministic } from "../src/core/determinism";
import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const stage3 = demoGame.stages[2]!;
const character = demoGame.characters[0]!; // Spread
const STAGE3_SEED = mixSeed(demoGame.seed, 2); // per-stage seed for stage index 2 (as the screen derives it)
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

// A weaving, shooting bot over the whole scene span — so waves, the midboss, and the moving boss
// all evaluate (phases time out; the bot doesn't centre on them, which is fine — we want the
// content to RUN deterministically, not to be cleared).
const scripted: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  scripted.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
}

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(40)} ${detail}`);
  if (!pass) failures++;
};

console.log(`\n⟐ Rank sweep — Stage 3 runs at Easy/Normal/Hard/Lunatic\n`);

const ranks = [Rank.Easy, Rank.Normal, Rank.Hard, Rank.Lunatic];
const names = ["Easy", "Normal", "Hard", "Lunatic"];

// ── Reproducibility (A==B) at every rank — and each rank actually EXECUTES here ──
const hashes: number[] = [];
ranks.forEach((r, i) => {
  const d = checkDeterministic(stage3, STAGE3_SEED, scripted, DT, character, r, demoGame.config);
  hashes.push(d.hashA);
  check(`${names[i]} runs + reproduces (A==B)`, d.ok, `${hex(d.hashA)} (${d.ticks}t)`);
});
check("all four ranks are distinct trajectories", new Set(hashes).size === 4, `${new Set(hashes).size}/4 unique`);

// ── Density climbs with rank (the numeric stand-in for the visual live-check) ─────
function density(rank: number): { bulletTicks: number; peak: number } {
  const sim = createStageSim(stage3, STAGE3_SEED, character, rank, demoGame.config, DT);
  let bulletTicks = 0;
  let peak = 0;
  for (let i = 0; i < scripted.length; i++) {
    sim.step(scripted[i]!);
    bulletTicks += sim.system.liveCount;
    if (sim.system.liveCount > peak) peak = sim.system.liveCount;
  }
  return { bulletTicks, peak };
}
const dens = ranks.map((r, i) => ({ name: names[i], ...density(r) }));
for (const d of dens) console.log(`      density  ${d.name.padEnd(8)} ${d.bulletTicks} bullet-ticks  peak ${d.peak}`);
const climbs = dens.every((d, i) => i === 0 || d.bulletTicks > dens[i - 1]!.bulletTicks);
check("density climbs Easy → Lunatic", climbs, `${dens[0]!.bulletTicks} → ${dens[3]!.bulletTicks}`);
check("peak density differs across ranks", new Set(dens.map((d) => d.peak)).size > 1, `peaks ${dens.map((d) => d.peak).join("/")}`);

console.log(failures === 0 ? "\n✓ RANK SWEEP PASS — Stage 3 runs deterministically at all four ranks\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
