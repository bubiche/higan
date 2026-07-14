// Firing-assert harness for the boss/enemy fire + laser SFX.
//
// Why this exists: full-run-replay proves the sim's HASH is unchanged (i.e. the new SFX emits
// don't perturb a replay) — but a missing cue also changes no hash, so a broken wiring
// (notifyFire not threaded, laser scan off-by-one) would pass full-run-replay SILENTLY. This
// harness proves the cues actually FIRE by reading sim.events, and re-confirms determinism
// with the emits live. The sound itself is only verifiable in a live browser.
//
// Run: pnpm test sfx-fire-laser

import { createStageSim, type Simulation } from "../src/core/sim";
import { assertDeterministic } from "../src/core/determinism";
import { DT } from "../src/core/playfield";
import { SfxId } from "../src/core/events";
import type { InputFrame } from "../src/core/input";
import type { StageDef } from "../src/api/game";
import type { BossScript } from "../src/api/boss";
import type { EmitterScript } from "../src/api/emitter";
import { demoGame } from "../games/demo/game";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  if (!pass) failures++;
};

// A minimal synthetic boss whose one phase fires a ring (→ EnemyShoot) and a short-telegraph
// laser (→ Laser, at the telegraph→fire transition) on a fast cadence. hp is effectively
// infinite and no shots are fired, so the phase never ends over the harness window — it just
// keeps firing, which is all we need to observe both cues.
const TELEGRAPH = 5;
const firingBody: EmitterScript = function* (ctx) {
  while (true) {
    ctx.ring({ count: 12, speed: 100, radius: 4 });
    ctx.laser({ angle: Math.PI / 2, length: 400, width: 12, telegraph: TELEGRAPH, duration: 40 });
    yield 30;
  }
};
const firingBoss: BossScript = function* (b) {
  yield* b.phase({ name: "SFX Probe", hp: 1e9, timeLimit: 1e9 }, firingBody);
};
const probeStage: StageDef = {
  id: "sfx-probe",
  script: function* (ctx) {
    yield* ctx.boss(firingBoss);
  },
};

const CHAR = demoGame.characters[0]!;
const CONFIG = demoGame.config;
const SEED = 0x1234;
const RANK = 0;
const TICKS = 220;
const NEUTRAL: InputFrame = { dx: 0, dy: 0, shoot: false, focus: false, bomb: false };

// ── 1. The cues fire, and at the expected timing ──────────────────────────────────
const sim: Simulation = createStageSim(probeStage, SEED, CHAR, RANK, CONFIG, DT);
let firstEnemyShoot = -1;
let firstLaser = -1;
let enemyShootCount = 0;
let laserCount = 0;
for (let t = 0; t < TICKS; t++) {
  sim.step(NEUTRAL);
  for (const e of sim.events) {
    if (e.id === SfxId.EnemyShoot) {
      enemyShootCount++;
      if (firstEnemyShoot < 0) firstEnemyShoot = t;
    }
    if (e.id === SfxId.Laser) {
      laserCount++;
      if (firstLaser < 0) firstLaser = t;
    }
  }
}
check("boss ring raises EnemyShoot", firstEnemyShoot >= 0, `first at tick ${firstEnemyShoot}, ${enemyShootCount} total`);
check("boss laser raises Laser", firstLaser >= 0, `first at tick ${firstLaser}, ${laserCount} total`);
// The laser cue must land AFTER its enemy-shoot sibling (the beam telegraphs before it goes
// live) — proves the cue is at the fire transition, not at spawn.
check("Laser lands after the beam telegraphs", firstLaser > firstEnemyShoot, `laser@${firstLaser} > shoot@${firstEnemyShoot}`);

// ── 2. The player's own Shoot is NOT the enemy cue ────────────────────────────────
// With shoot:false the player never fires, so any EnemyShoot we saw is genuinely the boss,
// and no player Shoot should appear.
const sawPlayerShoot = ((): boolean => {
  const s = createStageSim(probeStage, SEED, CHAR, RANK, CONFIG, DT);
  for (let t = 0; t < 40; t++) {
    s.step(NEUTRAL);
    for (const e of s.events) if (e.id === SfxId.Shoot) return true;
  }
  return false;
})();
check("no player Shoot with shoot released", !sawPlayerShoot, "EnemyShoot is the boss, not the player");

// ── 3. Determinism holds with the emits live ──────────────────────────────────────
const inputs: InputFrame[] = Array.from({ length: TICKS }, () => NEUTRAL);
try {
  const r = assertDeterministic(probeStage, SEED, inputs, DT, CHAR, RANK, CONFIG);
  check("determinism green with fire/laser SFX live", r.ok, `hash 0x${r.hashA.toString(16)} over ${r.ticks} ticks`);
} catch (err) {
  check("determinism green with fire/laser SFX live", false, String(err));
}

// ── 4. The demo's real bosses actually reach the cues (sanity on the shipped content) ──
// Every demo stage boss both ring/fans and lasers; here we just confirm the wiring is on the
// path the real demo uses, by exercising stage 1 far enough to see enemy fire from popcorn.
const realStage = demoGame.stages[0]!;
const realSim = createStageSim(realStage, SEED, CHAR, RANK, CONFIG, DT);
let realEnemyShoot = false;
for (let t = 0; t < 400 && !realEnemyShoot; t++) {
  realSim.step(NEUTRAL);
  for (const e of realSim.events) if (e.id === SfxId.EnemyShoot) realEnemyShoot = true;
}
check("demo stage 1 popcorn/enemies raise EnemyShoot", realEnemyShoot, "engine-default sound is audible in the demo");

console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
