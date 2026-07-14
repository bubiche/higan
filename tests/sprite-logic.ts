// Sprites — positive test of the pure sprite logic.
//
// The determinism suite proves sprites didn't BREAK anything (baselines bit-identical), but
// sprites are UNHASHED — so a completely broken pipeline (marshal dropping every instance,
// animation never advancing, overlapping layer assignment) would ALSO pass every baseline.
// This is the "a silent spine still passes a hash check" trap sfx-events called out for audio.
// So this asserts the parts a hash can't see, all GL-free (headless):
//
//  1. planSpriteLayout — engine defaults at fixed layers; library laid out consecutively;
//     animated sprites get contiguous frames; handles stamped; item overrides win.
//  2. animatedLayer — cycles base → base+frames-1 → base at fps; static when absent; -1 passthrough.
//  3. marshalEnemies / marshalItems — pack the resolved layer into slot 7, skip dead + layer<0.

import { planSpriteLayout, animatedLayer } from "../src/render/atlas";
import { marshalEnemies } from "../src/render/enemies";
import { marshalItems } from "../src/render/items";
import { INSTANCE_FLOATS } from "../src/render/bullets";
import { defineSprites } from "../src/api";
import { ItemType } from "../src/touhou/item";
import type { Enemy } from "../src/touhou/enemy";
import type { Item } from "../src/touhou/item";

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(44)} ${detail}`);
  if (!pass) failures++;
};

// ── 1. planSpriteLayout ────────────────────────────────────────────────────────

// No manifest → just the engine defaults: enemy 0, player 1, items 2–6, total 7.
const bare = planSpriteLayout(undefined);
check("defaults: enemy=0 player=1", bare.defaultEnemyLayer === 0 && bare.defaultPlayerLayer === 1,
  `enemy=${bare.defaultEnemyLayer} player=${bare.defaultPlayerLayer}`);
check("defaults: items 2..6", [ItemType.Power, ItemType.Point, ItemType.Life, ItemType.Bomb, ItemType.FullPower]
  .every((t, i) => bare.itemLayer[t] === 2 + i), JSON.stringify(bare.itemLayer));
check("defaults: total 7 layers", bare.totalLayers === 7, `total=${bare.totalLayers}`);
check("defaults: nothing animated", bare.anim.size === 0, `anim.size=${bare.anim.size}`);

// A library: an animated fairy (4 frames), a static sentinel, a static player. Consecutive
// after the 7 defaults; the animated one occupies 4 contiguous layers; handles get stamped.
const sprites = defineSprites({
  fairy: { source: { kind: "procedural", draw: () => {} }, frames: 4, fps: 10 },
  sentinel: { source: { kind: "procedural", draw: () => {} } },
  player: { source: { kind: "procedural", draw: () => {} } },
});
const lib = planSpriteLayout({ library: sprites });
check("library: fairy base 7 (after defaults)", sprites.fairy.layer === 7, `fairy.layer=${sprites.fairy.layer}`);
check("library: sentinel base 11 (fairy took 4)", sprites.sentinel.layer === 11, `sentinel.layer=${sprites.sentinel.layer}`);
check("library: player base 12", sprites.player.layer === 12, `player.layer=${sprites.player.layer}`);
check("library: total 13 layers", lib.totalLayers === 13, `total=${lib.totalLayers}`);
check("library: only fairy animated {4,10}", lib.anim.size === 1 && lib.anim.get(7)?.frames === 4 && lib.anim.get(7)?.fps === 10,
  `anim=${JSON.stringify([...lib.anim])}`);
check("library: defaults unshifted (enemy 0, items 2..6)", lib.defaultEnemyLayer === 0 && lib.itemLayer[ItemType.Point] === 3,
  `enemy=${lib.defaultEnemyLayer} point=${lib.itemLayer[ItemType.Point]}`);

// An item override wins for its type; other types keep the default; it lands after the library.
const withOverride = planSpriteLayout({
  library: sprites,
  items: { [ItemType.Power]: { source: { kind: "procedural", draw: () => {} } } },
});
check("override: Power remapped past library", withOverride.itemLayer[ItemType.Power] === 13,
  `power=${withOverride.itemLayer[ItemType.Power]}`);
check("override: Point still default (3)", withOverride.itemLayer[ItemType.Point] === 3,
  `point=${withOverride.itemLayer[ItemType.Point]}`);

// An ANIMATED item override cycles too — its frames are reserved past the library AND it lands
// in the anim map (regression: overrides used to reserve frames but never register to animate).
const withAnimOverride = planSpriteLayout({
  library: sprites,
  items: { [ItemType.Point]: { source: { kind: "procedural", draw: () => {} }, frames: 3, fps: 8 } },
});
const pointBase = withAnimOverride.itemLayer[ItemType.Point];
check("anim override: Point remapped past library (13)", pointBase === 13, `point=${pointBase}`);
check("anim override: reserves 3 frames (total 16)", withAnimOverride.totalLayers === 16, `total=${withAnimOverride.totalLayers}`);
check("anim override: in anim map {3,8}",
  withAnimOverride.anim.get(pointBase)?.frames === 3 && withAnimOverride.anim.get(pointBase)?.fps === 8,
  `anim=${JSON.stringify([...withAnimOverride.anim])}`);
check("anim override: cycles to frame 1 at t=0.125", animatedLayer(withAnimOverride.anim, pointBase, 0.125) === pointBase + 1,
  `${animatedLayer(withAnimOverride.anim, pointBase, 0.125)}`);

// ── 2. animatedLayer ───────────────────────────────────────────────────────────

const anim = lib.anim; // { 7 → {frames:4, fps:10} }
check("anim: frame 0 at t=0", animatedLayer(anim, 7, 0) === 7, `${animatedLayer(anim, 7, 0)}`);
check("anim: frame 1 at t=0.1", animatedLayer(anim, 7, 0.1) === 8, `${animatedLayer(anim, 7, 0.1)}`);
check("anim: frame 3 at t=0.35", animatedLayer(anim, 7, 0.35) === 10, `${animatedLayer(anim, 7, 0.35)}`);
check("anim: wraps to frame 0 at t=0.4", animatedLayer(anim, 7, 0.4) === 7, `${animatedLayer(anim, 7, 0.4)}`);
check("anim: static base unchanged", animatedLayer(anim, 11, 999) === 11, `${animatedLayer(anim, 11, 999)}`);
check("anim: base < 0 → -1", animatedLayer(anim, -1, 0) === -1, `${animatedLayer(anim, -1, 0)}`);

// ── 3. marshalEnemies / marshalItems ─────────────────────────────────────────────

const enemy = (alive: boolean, x: number, y: number, radius: number, rgb: [number, number, number], sprite: number): Enemy =>
  ({ alive, x, y, radius, r: rgb[0], g: rgb[1], b: rgb[2], sprite, hp: 1, hpMax: 1, age: 0, drops: undefined }) as Enemy;

const enemies: Enemy[] = [
  enemy(true, 10, 20, 14, [1, 0.5, 0.2], 7),
  enemy(false, 0, 0, 0, [0, 0, 0], 7), // dead → skipped
  enemy(true, 30, 40, 16, [0.5, 0.9, 0.85], -1), // sprite -1 → resolver returns default
];
const out = new Float32Array(enemies.length * INSTANCE_FLOATS);

// Identity resolver: the -1 enemy resolves to -1 and is SKIPPED.
const nId = marshalEnemies(enemies, out, (b) => b);
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6; // Float32 rounds 0.2
const firstOk = out[0] === 10 && out[1] === 20 && out[2] === 14 && out[3] === 0 &&
  near(out[4]!, 1) && near(out[5]!, 0.5) && near(out[6]!, 0.2) && out[7] === 7;
check("enemies: identity skips dead + layer<0", nId === 1, `count=${nId}`);
check("enemies: packed floats (slot 7 = layer)", firstOk, `[${Array.from(out.slice(0, INSTANCE_FLOATS)).join(",")}]`);

// Default-substitution resolver: the -1 enemy now resolves to layer 0 and IS drawn.
const nDef = marshalEnemies(enemies, out, (b) => (b < 0 ? 0 : b));
check("enemies: default substitution draws the -1 one", nDef === 2, `count=${nDef}`);
check("enemies: substituted layer packed", out[INSTANCE_FLOATS + 7] === 0, `slot7=${out[INSTANCE_FLOATS + 7]}`);

const item = (alive: boolean, x: number, y: number, type: ItemType, rgb: [number, number, number]): Item =>
  ({ alive, x, y, type, r: rgb[0], g: rgb[1], b: rgb[2] }) as Item;

const items: Item[] = [
  item(true, 5, 6, ItemType.Power, [1, 0.3, 0.3]),
  item(false, 0, 0, ItemType.Point, [0, 0, 0]), // dead → skipped
  item(true, 7, 8, ItemType.Point, [0.4, 0.65, 1]),
];
const iout = new Float32Array(items.length * INSTANCE_FLOATS);
const ni = marshalItems(items, iout, (t) => bare.itemLayer[t]);
const itemOk = iout[0] === 5 && iout[1] === 6 && iout[2] === 6 && iout[7] === 2 && // Power → layer 2, radius 6
  iout[INSTANCE_FLOATS] === 7 && iout[INSTANCE_FLOATS + 7] === 3; // Point → layer 3
check("items: resolve by type, skip dead", ni === 2, `count=${ni}`);
check("items: packed floats (type→layer, radius 6)", itemOk,
  `[${Array.from(iout.slice(0, INSTANCE_FLOATS)).join(",")}]`);
check("items: resolver < 0 skips all", marshalItems(items, iout, () => -1) === 0, "count=0");

console.log("");
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
