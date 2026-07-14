// All-stage rank sweep — EVERY stage scales cleanly across all four difficulty ranks.
//
// The per-stage rank fixtures (stage2-ranks, stage3-ranks, extra-stage) each proved
// one stage; Stage 1 had only its NORMAL determinism anchor, never an all-four-ranks density
// check. This consolidates all of it: for every stage in the game (the three main stages AND
// the Extra stage), step its whole scene at Easy/Normal/Hard/Lunatic and assert each is
// (a) reproducible A==B, (b) a distinct trajectory per rank (content actually branches on the
// rank), and (c) denser than the rank below it (scale() genuinely thickens it). A throw at any
// rank crashes the harness, so this is also the no-throw check across the whole game. Balance is
// iterative, not gated, so no hash is frozen here — this proves the scale() hooks RUN, not a
// specific tuning.

import { checkDeterministic } from "../src/core/determinism";
import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const character = demoGame.characters[0]!; // Spread
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

// A weaving, shooting bot over a long span — so every stage's waves, midboss, and boss all
// evaluate (phases time out; the bot isn't trying to clear, only to make the content RUN).
const scripted: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  scripted.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
}

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${detail}`);
  if (!pass) failures++;
};

console.log(`\n⟐ All-stage rank sweep — every stage runs at Easy/Normal/Hard/Lunatic\n`);

const ranks = [Rank.Easy, Rank.Normal, Rank.Hard, Rank.Lunatic];
const names = ["Easy", "Normal", "Hard", "Lunatic"];

function densityAt(stage: (typeof demoGame.stages)[number], seed: number, rank: number): number {
  const sim = createStageSim(stage, seed, character, rank, demoGame.config, DT);
  let bulletTicks = 0;
  for (let i = 0; i < scripted.length; i++) {
    sim.step(scripted[i]!);
    bulletTicks += sim.system.liveCount;
  }
  return bulletTicks;
}

demoGame.stages.forEach((stage, index) => {
  const seed = mixSeed(demoGame.seed, index); // per-stage seed, exactly as the screen derives it
  console.log(`── ${stage.id}${stage.extra ? " (extra)" : ""} ─────────────────────────────`);

  // Reproducibility (A==B) at every rank — and each rank actually EXECUTES here (no throw).
  const hashes: number[] = [];
  ranks.forEach((r, i) => {
    const d = checkDeterministic(stage, seed, scripted, DT, character, r, demoGame.config);
    hashes.push(d.hashA);
    check(`${stage.id} ${names[i]} runs + reproduces (A==B)`, d.ok, `${hex(d.hashA)} (${d.ticks}t)`);
  });
  check(`${stage.id}: four distinct rank trajectories`, new Set(hashes).size === 4, `${new Set(hashes).size}/4 unique`);

  // Density climbs with rank (the numeric stand-in for the visual live-check).
  const dens = ranks.map((r, i) => ({ name: names[i], bulletTicks: densityAt(stage, seed, r) }));
  for (const d of dens) console.log(`      density  ${d.name.padEnd(8)} ${d.bulletTicks} bullet-ticks`);
  const climbs = dens.every((d, i) => i === 0 || d.bulletTicks > dens[i - 1]!.bulletTicks);
  check(`${stage.id}: density climbs Easy → Lunatic`, climbs, `${dens[0]!.bulletTicks} → ${dens[3]!.bulletTicks}`);
});

console.log(failures === 0 ? "\n✓ ALL-STAGE RANK SWEEP PASS — every stage scales cleanly at all four ranks\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
