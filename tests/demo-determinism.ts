// Demo-context determinism check for the new survival phase — mirrors the boot guard in
// games/demo/main.ts, but headless. Runs the REAL demo stage 1 (which now includes the
// endurance "Aegis Vigil" survival phase on its boss) twice over an 8000-tick scripted weave
// and asserts a bit-identical trajectory hash. Proves the survival gates don't introduce
// nondeterminism in the actual game content (not just the isolated fixture).

import { assertDeterministic } from "../src/core/determinism";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const scripted: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  scripted.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
}

const stage = demoGame.stages[0]!;
const det = assertDeterministic(
  stage,
  mixSeed(demoGame.seed, 0),
  scripted,
  DT,
  demoGame.characters[0]!,
  NORMAL,
  demoGame.config,
);
console.info(
  `demo-determinism PASSED — stage ${stage.id} deterministic over ${det.ticks} ticks, ` +
    `hash 0x${det.hashA.toString(16).padStart(8, "0")}`,
);
