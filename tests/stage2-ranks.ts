// Rank sweep — Stage 2 content RUNS at all four difficulty ranks.
//
// `campaign-two-stage.ts` proved the Stage 1→2 spine, but only at Easy; `main.ts`'s boot guard runs
// Normal, but only in a live DEV browser. So Hard and Lunatic had executed NOWHERE, and the
// "scale() ≥ 1 at Easy" arithmetic check only rules out the THINNEST rank going to zero — it
// says nothing about the DENSEST rank. This closes that gap: it actually steps Stage 2's scene
// (its own waves/midboss/boss, including the ramp/wave patterns) at Easy/Normal/Hard/Lunatic and
// asserts each is (a) reproducible A==B, (b) a distinct trajectory (content branches on rank),
// and (c) denser than the rank below it (scale() genuinely thickens it). A throw at any rank
// crashes the harness — so this is also the no-throw check. Stage 2 balance is iterative, not
// gated, so no specific hash is frozen (unlike Stage 1's NORMAL anchor).

import { checkDeterministic } from "../src/core/determinism";
import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const stage2 = demoGame.stages[1]!;
const character = demoGame.characters[0]!; // Spread
const STAGE2_SEED = mixSeed(demoGame.seed, 1); // per-stage seed for stage index 1 (as the screen derives it)
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

// A weaving, shooting bot over the whole scene span — so waves, the midboss, and the boss all
// evaluate (phases time out; the bot doesn't centre on them, which is fine — we want the content
// to RUN deterministically, not to be cleared).
const scripted: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  scripted.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
}

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(40)} ${detail}`);
  if (!pass) failures++;
};

console.log(`\n⟐ Rank sweep — Stage 2 runs at Easy/Normal/Hard/Lunatic\n`);

const ranks = [Rank.Easy, Rank.Normal, Rank.Hard, Rank.Lunatic];
const names = ["Easy", "Normal", "Hard", "Lunatic"];

// ── Reproducibility (A==B) at every rank — and each rank actually EXECUTES here ──
const hashes: number[] = [];
ranks.forEach((r, i) => {
  const d = checkDeterministic(stage2, STAGE2_SEED, scripted, DT, character, r, demoGame.config);
  hashes.push(d.hashA);
  check(`${names[i]} runs + reproduces (A==B)`, d.ok, `${hex(d.hashA)} (${d.ticks}t)`);
});
check("all four ranks are distinct trajectories", new Set(hashes).size === 4, `${new Set(hashes).size}/4 unique`);

// ── Density climbs with rank (the numeric stand-in for the visual live-check) ─────
function density(rank: number): { bulletTicks: number; peak: number } {
  const sim = createStageSim(stage2, STAGE2_SEED, character, rank, demoGame.config, DT);
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

console.log(failures === 0 ? "\n✓ RANK SWEEP PASS — Stage 2 runs deterministically at all four ranks\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
