// Confirm the DEV boot determinism guard (main.ts:123, run-twice self-consistency) still
// passes now that `emberPattern` was added to SHOWCASE — i.e. loading the demo (or
// ?preview=ember) won't throw at boot. Mirrors the boot guard's stage + input exactly.
import { assertDeterministic } from "../src/core/determinism";
import { showcaseStage } from "../games/demo/showcase";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import type { StageDef } from "../src/api/game";
import type { InputFrame } from "../src/core/input";

const PATTERN_TICKS = 300; // matches main.ts PATTERN_TICKS * 13 window shape (value irrelevant to self-consistency)
const STAGE_SEED = mixSeed(demoGame.seed, 0);
const char = demoGame.characters[0]!;
const def: StageDef = { id: "showcase", script: showcaseStage };
const input: InputFrame[] = [];
for (let i = 0; i < PATTERN_TICKS * 13; i++) {
  input.push({ dx: ((i >> 4) % 3) - 1, dy: ((i >> 5) % 3) - 1, shoot: (i & 8) !== 0, focus: i % 120 < 30, bomb: false });
}
const d = assertDeterministic(def, STAGE_SEED, input, DT, char, NORMAL, demoGame.config);
console.log(`PASS  showcase (with ember) boot guard self-consistent  0x${d.hashA.toString(16).padStart(8, "0")} (${d.ticks}t)`);
