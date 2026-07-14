// Endurance / survival spell fixture — the proof for the survival-phase feature.
//
// Same one-phase boss with a low hp (1) fought TWO ways, flag flipped, opposite outcome:
//   • ORDINARY (survival:false): shots reach the boss and drain the 1 hp almost immediately
//     → the phase ends by HP-capture WELL before the timer (proves shots DO reach/damage).
//   • SURVIVAL (survival:true):  the SAME geometry, but the boss is invulnerable → hp never
//     drops, shots pass through, and the phase ends only at the timer — outlasting it no-miss
//     is the CAPTURE (a SpellCapture event fires, full time bonus awarded).
// Plus a control: a NORMAL phase whose hp is too high to drain times out with NO capture (the
// pre-existing rule), and determinism holds (the survival run, twice, is bit-identical).

import { createStageSim, type Simulation } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { SfxId } from "../src/core/events";
import type { BossScript } from "../src/api/boss";
import type { EmitterScript } from "../src/api/emitter";
import type { StageScript } from "../src/api/stage";
import { DEFAULT_RUN_CONFIG } from "../src/api/config";
import { demoGame } from "../games/demo/game";

const character = demoGame.characters[0]!;
const SEED = mixSeed(demoGame.seed, 0);
const TIME_LIMIT = 120; // 2s
const RUN_TICKS = 400;

// A NON-firing body: the boss disc is present (so player shots hit it and we can prove the
// invulnerability gate), but the field stays empty — so the phase-end bullet-cancel awards ~0
// and a survival run's `finalScore` is EXACTLY the spell bonus, making the full-bonus assertion
// below a real discriminator (a dense field would swamp the 2M bonus with cancel/point score).
const body: EmitterScript = function* () {
  while (true) yield 30;
};

function makeBoss(survival: boolean, hp: number): BossScript {
  return function* (b) {
    yield* b.phase({ name: "Test", hp, timeLimit: TIME_LIMIT, isSpell: true, survival }, body);
  };
}

interface RunResult {
  hpMinWhileActive: number;
  hpMaxWhileActive: number;
  everActive: boolean;
  activeTicks: number;
  captures: number;
  /** Score sampled at the tick the SpellCapture event fires — the spell bonus is added in
   *  endPhase on that tick (before the SEPARATE stage-clear bonus, which lands a tick or two
   *  later when the single-phase boss returns and the stage completes). So this isolates the
   *  capture bonus. -1 if no capture fired. */
  scoreAtCapture: number;
  shotsSeen: number;
  hash: number;
}

function run(boss: BossScript): RunResult {
  const stage: StageScript = function* (ctx) {
    yield* ctx.boss(boss);
  };
  const sim: Simulation = createStageSim(
    { id: "survival-test", script: stage },
    SEED,
    character,
    0,
    DEFAULT_RUN_CONFIG,
    DT,
  );
  const r: RunResult = {
    hpMinWhileActive: Infinity,
    hpMaxWhileActive: -Infinity,
    everActive: false,
    activeTicks: 0,
    captures: 0,
    scoreAtCapture: -1,
    shotsSeen: 0,
    hash: 0,
  };
  for (let i = 0; i < RUN_TICKS; i++) {
    // Hold shoot + FOCUS; don't move. Focus narrows the spread fan into a tight centred column,
    // and the player spawns at the boss x — so the column tracks the boss disc dead-on (an
    // unfocused fan straddles the small disc at range).
    sim.step({ dx: 0, dy: 0, shoot: true, focus: true, bomb: false });
    const boss = sim.boss;
    if (boss && boss.active) {
      r.everActive = true;
      r.activeTicks++;
      r.hpMinWhileActive = Math.min(r.hpMinWhileActive, boss.hp);
      r.hpMaxWhileActive = Math.max(r.hpMaxWhileActive, boss.hp);
      r.shotsSeen = Math.max(r.shotsSeen, sim.shots.liveCount);
    }
    for (const e of sim.events)
      if (e.id === SfxId.SpellCapture) {
        r.captures++;
        if (r.scoreAtCapture < 0) r.scoreAtCapture = sim.player.score; // before stage-clear bonus
      }
  }
  r.hash = sim.hash();
  return r;
}

const fails: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, msg: string): void => {
  (cond ? ok : fails).push(msg);
};

// ── Ordinary phase, hp=1: shots reach and drain it → HP-capture before the timer. ──
const ordinary = run(makeBoss(false, 1));
check(ordinary.everActive, "ordinary: phase ran");
check(ordinary.shotsSeen > 0, `ordinary: player shots present near boss (${ordinary.shotsSeen})`);
check(ordinary.hpMinWhileActive <= 0, `ordinary: hp drained to 0 (min ${ordinary.hpMinWhileActive})`);
check(
  ordinary.activeTicks < TIME_LIMIT,
  `ordinary: ended by HP BEFORE the timer (${ordinary.activeTicks} < ${TIME_LIMIT})`,
);
check(ordinary.captures === 1, `ordinary: exactly one capture (got ${ordinary.captures})`);

// ── Survival phase, SAME hp=1: invulnerable → hp never drops, ends only at the timer. ──
const survival = run(makeBoss(true, 1));
check(survival.everActive, "survival: phase ran");
check(survival.shotsSeen > 0, `survival: player shots present near boss (${survival.shotsSeen})`);
check(
  survival.hpMinWhileActive === survival.hpMaxWhileActive && survival.hpMinWhileActive === 1,
  `survival: hp locked at 1 despite shooting (min ${survival.hpMinWhileActive}, max ${survival.hpMaxWhileActive})`,
);
check(
  survival.activeTicks >= TIME_LIMIT,
  `survival: outlasted the full timer (${survival.activeTicks} >= ${TIME_LIMIT})`,
);
check(survival.captures === 1, `survival: outlasting no-miss = one capture (got ${survival.captures})`);
// Full time bonus: elapsed 0 → EXACTLY spellBonusBase (2,000,000). Sampled at the capture tick
// (before the stage-clear bonus), with a non-firing body (empty field → no cancel score), so
// this is purely the capture bonus — an exact match proves FULL (a partial at-timeout bonus
// would be ≤ base − decay).
check(
  survival.scoreAtCapture === DEFAULT_RUN_CONFIG.scoring.spellBonusBase,
  `survival: FULL time bonus awarded (${survival.scoreAtCapture} === ${DEFAULT_RUN_CONFIG.scoring.spellBonusBase})`,
);
// And the ORDINARY hp-capture pays LESS (declining-with-time), proving survival's full bonus
// isn't just what every capture gets — the ordinary capture at ~tick 24 lost ~24k to decay.
check(
  ordinary.scoreAtCapture > 0 && ordinary.scoreAtCapture < DEFAULT_RUN_CONFIG.scoring.spellBonusBase,
  `ordinary: capture bonus declined with time (${ordinary.scoreAtCapture} < ${DEFAULT_RUN_CONFIG.scoring.spellBonusBase})`,
);

// ── Control: a NORMAL phase with hp too high to drain times out with NO capture. ──
const tough = run(makeBoss(false, 10_000_000));
check(tough.everActive, "tough-normal: phase ran");
check(tough.hpMinWhileActive > 0, "tough-normal: hp never fully drained");
check(
  tough.activeTicks >= TIME_LIMIT,
  `tough-normal: ran to the timer (${tough.activeTicks} >= ${TIME_LIMIT})`,
);
check(tough.captures === 0, `tough-normal: timeout is NOT a capture (got ${tough.captures})`);

// ── Determinism: the survival run, twice, is bit-identical. ──
const survivalB = run(makeBoss(true, 1));
check(
  survival.hash === survivalB.hash,
  `survival: deterministic (0x${survival.hash.toString(16)} === 0x${survivalB.hash.toString(16)})`,
);

for (const m of ok) console.info(`  ✓ ${m}`);
for (const m of fails) console.error(`  ✗ ${m}`);
if (fails.length) {
  console.error(`\nsurvival-spell FAILED (${fails.length})`);
  process.exit(1);
}
console.info(`\nsurvival-spell PASSED (${ok.length} checks)`);
