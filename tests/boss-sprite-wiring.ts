// Boss-body wiring check — the headless half of the boss-sprite live-check.
//
// The boss body renders only in a live GL browser, but the single most likely "still
// invisible" failure is NOT a GL bug — it's the handle→layer wiring: a body sprite handle
// that never gets an atlas layer stamped (e.g. not actually in `assets.sprites.library`, or
// a visual pointing at the wrong handle) resolves to layer -1 and draws nothing. That half
// IS testable headlessly: `planSpriteLayout` is pure (no GL/DOM) and stamps `handle.layer`
// on every library handle, exactly as the live loader does. So this asserts that after the
// atlas is planned from the demo's real manifest, every boss body handle — and every
// `*_VISUAL.sprite` the stages pass to `ctx.boss` — carries a real (>= 0) layer. What's
// LEFT for the live eyeball is only the actual pixel (position/size/tint), not the wiring.

import { planSpriteLayout } from "../src/render/atlas";
import { demoGame } from "../games/demo/game";
import { demoSprites } from "../games/demo/sprites";
import { DEMO_BOSS_VISUAL } from "../games/demo/stages/stage1/boss";
import { MIDBOSS_VISUAL } from "../games/demo/stages/stage1/midboss";
import { EMBER_BOSS_VISUAL } from "../games/demo/stages/stage2/boss";
import { EMBER_MIDBOSS_VISUAL } from "../games/demo/stages/stage2/midboss";
import { NOCTURNE_BOSS_VISUAL } from "../games/demo/stages/stage3/boss";
import { NOCTURNE_MIDBOSS_VISUAL } from "../games/demo/stages/stage3/midboss";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${detail}`);
  if (!pass) failures++;
};

console.log(`\n⟐ Boss-body wiring — handles get atlased layers (headless half of the live-check)\n`);

// Plan the atlas from the demo's REAL manifest — the same input the live loader gets. This
// stamps `handle.layer` on every library handle (mutates them in place, shared by reference).
planSpriteLayout(demoGame.assets!.sprites);

// Every body sprite must land on a real atlas layer (i.e. it IS in the library).
check("gatekeeperBody atlased", demoSprites.gatekeeperBody.layer >= 0, `layer ${demoSprites.gatekeeperBody.layer}`);
check("songstressBody atlased", demoSprites.songstressBody.layer >= 0, `layer ${demoSprites.songstressBody.layer}`);
check("sovereignBody atlased", demoSprites.sovereignBody.layer >= 0, `layer ${demoSprites.sovereignBody.layer}`);
check("midbossBody atlased", demoSprites.midbossBody.layer >= 0, `layer ${demoSprites.midbossBody.layer}`);

// End-to-end: every visual the stages pass to `ctx.boss(...)` points at an atlased handle,
// so the sim will stamp a real layer (not -1) onto `bossBody` when that encounter spawns.
const visuals: Array<{ name: string; sprite?: { id: string; layer: number } }> = [
  { name: "DEMO_BOSS_VISUAL (gatekeeper)", sprite: DEMO_BOSS_VISUAL.sprite },
  { name: "MIDBOSS_VISUAL (S1 midboss)", sprite: MIDBOSS_VISUAL.sprite },
  { name: "EMBER_BOSS_VISUAL (songstress)", sprite: EMBER_BOSS_VISUAL.sprite },
  { name: "EMBER_MIDBOSS_VISUAL (S2 midboss)", sprite: EMBER_MIDBOSS_VISUAL.sprite },
  { name: "NOCTURNE_BOSS_VISUAL (sovereign)", sprite: NOCTURNE_BOSS_VISUAL.sprite },
  { name: "NOCTURNE_MIDBOSS_VISUAL (S3 midboss)", sprite: NOCTURNE_MIDBOSS_VISUAL.sprite },
];
for (const v of visuals) {
  check(`${v.name} → atlased body`, (v.sprite?.layer ?? -1) >= 0, v.sprite ? `${v.sprite.id} @ layer ${v.sprite.layer}` : "no sprite");
}

// The shared-familiar idiom: all three midbosses reference the SAME handle (one silhouette, a
// different tint per stage).
check(
  "all three midbosses share one silhouette",
  MIDBOSS_VISUAL.sprite === EMBER_MIDBOSS_VISUAL.sprite &&
    MIDBOSS_VISUAL.sprite === NOCTURNE_MIDBOSS_VISUAL.sprite &&
    MIDBOSS_VISUAL.sprite === demoSprites.midbossBody,
  "same handle, different color",
);

console.log(
  failures === 0
    ? "\n✓ BOSS-BODY WIRING PASS — every boss body handle is atlased; only the live pixel is left to eyeball\n"
    : `\n✗ ${failures} FAILURE(S)\n`,
);
if (failures > 0) process.exitCode = 1;
