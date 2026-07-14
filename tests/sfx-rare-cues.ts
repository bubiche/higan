// Positive emission check for the Bomb SFX site.
//
// The determinism suite proves the sim is UNCHANGED; it exercises no audio code and can't
// show a sound actually fires. sfx-events already OBSERVED 8 of 12 gameplay ids emitting
// (Shoot/Graze/EnemyHit/EnemyDeath/SpellDeclare/ItemCollect/Cancel/Pichuun). Four were
// never seen firing in any fixture — Bomb, SpellCapture, Extend, PlayerDeathBomb — because
// they need deliberate, awkward-to-stage conditions. Their emit sites landed with the SFX
// event spine and have never been confirmed to actually push an event, so each is a
// "silently mute" suspect independent of the audio routing.
//
// Bomb is the one that's near-free headlessly: configurable-bomb's litmus fixture already presses a
// bomb with the player ALIVE (a plain Bomb, not the death-window PlayerDeathBomb). Reuse it
// to confirm `SfxId.Bomb` appears in `sim.events` on the bomb tick, carrying the player x for
// pan — moving Bomb from "unverified" to "verified". (SpellCapture / Extend / PlayerDeathBomb
// stay for the owner's live-check: capture a spell cleanly, earn an extend, deathbomb.)

import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { SfxId } from "../src/core/events";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import { Shape } from "../src/api";
import type { StageDef, StageScript, BossScript, EmitterScript } from "../src/api";
import type { SfxEvent } from "../src/core/events";

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const charSpread = demoGame.characters[0]!; // default full-screen defensive bomb

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(38)} ${detail}`);
  if (!pass) failures++;
};

// Same controlled fixture as configurable-bomb's litmus: a parked live player and a high-HP boss
// firing a steady ring, so the player is alive when the bomb fires (→ Bomb, not the
// death-window PlayerDeathBomb).
const litmusBody: EmitterScript = function* (ctx) {
  while (true) {
    ctx.ring({ count: 32, speed: 95, angle: ctx.tick * 0.07, radius: 4, color: [1, 1, 1], sprite: Shape.Orb });
    yield 4;
  }
};
const litmusBoss: BossScript = function* (b) {
  yield* b.phase({ name: "litmus", hp: 1_000_000, timeLimit: 1_000_000 }, litmusBody);
};
const litmusStageScript: StageScript = function* (ctx) {
  yield* ctx.boss(litmusBoss);
};
const litmusStage: StageDef = { id: "litmus", script: litmusStageScript };

const BOMB_TICK = 120; // press well before any ring bullet reaches the parked player
const SAMPLE_TICK = 130;

// Run the fixture, collecting every SFX event tagged with the tick it fired on.
const run = (pressBomb: boolean): { tick: number; e: SfxEvent }[] => {
  const sim = createStageSim(litmusStage, STAGE_SEED, charSpread, NORMAL, demoGame.config, DT);
  const seen: { tick: number; e: SfxEvent }[] = [];
  for (let i = 0; i <= SAMPLE_TICK; i++) {
    const bomb = pressBomb && i >= BOMB_TICK && i < BOMB_TICK + 5; // one rising edge at BOMB_TICK
    sim.step({ dx: 0, dy: 0, shoot: false, focus: false, bomb });
    for (const e of sim.events) seen.push({ tick: i, e });
  }
  return seen;
};

const pressed = run(true);
const bombEvents = pressed.filter((s) => s.e.id === SfxId.Bomb);
check("Bomb fires when a live player bombs", bombEvents.length > 0, `count=${bombEvents.length}`);
check(
  "Bomb fires on the bomb tick",
  bombEvents.some((s) => s.tick >= BOMB_TICK && s.tick < BOMB_TICK + 5),
  `ticks=[${bombEvents.map((s) => s.tick).join(",")}]`,
);
check(
  "Bomb carries player x (pan)",
  bombEvents.every((s) => typeof s.e.x === "number"),
  `x=${bombEvents.map((s) => s.e.x).join(",")}`,
);
// No PlayerDeathBomb here — the player is alive, so a live bomb must be the plain Bomb id.
check(
  "not the death-window PlayerDeathBomb",
  !pressed.some((s) => s.e.id === SfxId.PlayerDeathBomb),
  "none seen (player alive)",
);

// Tripwire: with bombs withheld, no Bomb event ever fires (the press is what emits it).
const idle = run(false);
check("no Bomb without a press", !idle.some((s) => s.e.id === SfxId.Bomb), "none seen");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
