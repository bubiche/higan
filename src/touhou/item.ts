// Item pool — the pickups enemies drop when shot down.
//
// Like the laser, player-shot, and enemy pools (and unlike enemy bullets), items
// are O(tens–hundreds), so the dumb-data SoA rule does NOT apply: that rule exists
// for O(10k) bullets' cache locality (Hard Rule 1). An item is a plain object in a
// fixed pre-allocated pool, iterated in pool order; the sim packs the live ones into
// a scratch Float32Array at hash time exactly the way it compacts live bullet slots,
// laser beams, player shots, and enemies.
//
// Determinism (Hard Rule 2): an item's IN-FLIGHT physics (pop-arc → gravity fall →
// magnet → home → collect) is a pure function of (tick, player position), consuming
// ZERO randomness — so collection never perturbs any danmaku stream and replays hold
// bit-identically. The one randomness an item touches is its SPAWN velocity scatter,
// and that is drawn by the SIM from the dedicated item stream (`rngItem`) — never
// here — so this module stays rng-free exactly as `shot.ts` does.
//
// What is gameplay vs presentation: position/velocity/state/age/type are sim state
// (hashed); the per-type sprite + colour are render-only (the genre-convention look,
// engine-owned — power = red, point = blue, etc.). Real item sprites swap in behind
// the asset slot at the presentation milestone with no change to this path.

import { PlayerState, type Player } from "./player";
import { awardPointItem, type ScoringConfig } from "./score";
import { Shape } from "../render/shapes";
import { PLAYFIELD_H } from "../core/playfield";

/** What an item gives on collection. The value carried per type is engine-owned
 *  (genre convention); content only chooses HOW MANY of each an enemy drops. */
export const ItemType = {
  Power: 0,
  Point: 1,
  Life: 2,
  Bomb: 3,
  FullPower: 4,
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

/** Item lifecycle. Hashed — it gates the physics and is gameplay-visible. Latched
 *  one-way (Falling → Attract, never back), so dropping back below the PoC line
 *  can't un-magnet an item and the hashed `state` stays clean. */
export const ItemState = {
  Falling: 0, // pop-up arc then gravity fall
  Attract: 1, // homing toward the player (PoC / full-power / proximity / bomb)
} as const;
export type ItemState = (typeof ItemState)[keyof typeof ItemState];

/**
 * A drop table: how many of each item an enemy yields when SHOT DOWN. Authored
 * content on an `EnemySpec` (a different game writes its own); the per-type look is
 * engine-owned, so the table is just counts.
 */
export interface ItemDropTable {
  readonly power?: number;
  readonly point?: number;
  readonly life?: number;
  readonly bomb?: number;
  readonly fullPower?: number;
}

// ── Physics + collection tuning ────────────────────────────────────────────────
// Promoted to a game-level RunConfig field (`RunConfig.item`, composed in
// api/config.ts): a game tunes the PoC height, magnet reach, power-per-item, drop
// kinematics, and the bullet-cancel item cap with zero engine edit (the "second game,
// zero src/ changes" litmus). Construction input — the values feed deterministic item
// physics but the object is not hashed. `DEFAULT_ITEM_CONFIG` carries the reference
// values. The drop-pop kinematics (`popVy`/`popScatter*`) and `cancelItemCap` are read
// by the SIM (it owns drop spawning + the bullet-cancel transform); the rest are read
// here (fall/magnet/collect physics + the collection effect).

/** Item physics, collection, and drop/cancel tuning. */
export interface ItemConfig {
  /** PoC line as a fraction of field height: a player above `PLAYFIELD_H * pocLineFrac`
   *  (near the top) auto-collects every item — the Point of Collection that rewards
   *  risky play. Also the boundary the point-item height-factor scales from. */
  readonly pocLineFrac: number;
  /** Downward acceleration on a falling item (sim units / s²). */
  readonly gravity: number;
  /** Fall-speed cap (sim units / s). */
  readonly terminalVy: number;
  /** Within this distance of the player, a falling item starts homing (the magnet). */
  readonly magnetRadius: number;
  /** Homing speed once attracting (faster than the player so it always catches up). */
  readonly attractSpeed: number;
  /** Within this distance of the player, an item is collected. */
  readonly collectRadius: number;
  /** Power gained per Power item (overflow past max converts to a point). */
  readonly powerPerItem: number;
  /** Drop-pop upward speed (sim-owned spawn kinematics). */
  readonly popVy: number;
  /** Drop-pop horizontal scatter half-range (sim-owned). */
  readonly popScatterX: number;
  /** Drop-pop vertical scatter half-range (sim-owned). */
  readonly popScatterVy: number;
  /** Bullet-cancel → point-item shower cap (sim-owned): at most this many cancelled
   *  bullets also leave a Point item; the rest only pay the flat cancel score. */
  readonly cancelItemCap: number;
}

/** The reference game's item values (the engine's defaults). */
export const DEFAULT_ITEM_CONFIG: ItemConfig = {
  pocLineFrac: 0.28,
  gravity: 360,
  terminalVy: 150,
  magnetRadius: 60,
  attractSpeed: 520,
  collectRadius: 14,
  powerPerItem: 4,
  popVy: 90,
  popScatterX: 35,
  popScatterVy: 25,
  cancelItemCap: 16,
};

/** A single item. Mutated in place inside its pool slot. */
export interface Item {
  alive: boolean;
  /** What it gives on collection (sim state — determines the effect). */
  type: ItemType;
  /** Position (sim units) — the canonical hashed/drawn/collided position. */
  x: number;
  y: number;
  /** Velocity (sim units / s). */
  vx: number;
  vy: number;
  /** Falling vs Attract (latched one-way). */
  state: ItemState;
  /** Ticks since spawn (sim state — folded into the hash). */
  age: number;
  /** Shape atlas layer — render-only (not hashed), like a laser's/enemy's colour. */
  sprite: number;
  /** Linear RGB tint, 0..1 — render-only. */
  r: number;
  g: number;
  b: number;
}

/** Spawn parameters — every field explicit; the velocity (with its rng scatter) is
 *  composed by the sim, and the per-type look comes from `ITEM_VISUAL`. */
export interface ItemSpawn {
  type: ItemType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sprite: number;
  r: number;
  g: number;
  b: number;
}

/** Per-type placeholder look (render-only, engine-owned genre convention). Real
 *  sprites swap in behind the asset slot later; the atlas layer is just an index. */
export const ITEM_VISUAL: Record<ItemType, { sprite: number; color: readonly [number, number, number] }> = {
  [ItemType.Power]: { sprite: Shape.Crystal, color: [1.0, 0.3, 0.3] },
  [ItemType.Point]: { sprite: Shape.Scale, color: [0.4, 0.65, 1.0] },
  [ItemType.Life]: { sprite: Shape.Heart, color: [1.0, 0.45, 0.7] },
  [ItemType.Bomb]: { sprite: Shape.Star, color: [0.4, 1.0, 0.5] },
  [ItemType.FullPower]: { sprite: Shape.BigOrb, color: [1.0, 0.9, 0.3] },
};

export interface ItemSystem {
  /** The fixed pool; iterate `[0, items.length)` and skip `!alive` slots. */
  readonly items: readonly Item[];
  /** Number of live items. */
  readonly liveCount: number;
  /** Spawn an item. A no-op (drop) if the pool is full — deterministic. */
  spawn(o: ItemSpawn): void;
  /** Despawn the item in slot `i` (used by collection when an item is picked up). */
  despawn(i: number): void;
  /**
   * Advance every live item one fixed step. Falling items pop then gravitate (capped
   * at terminal); an item flips to Attract — and stays — when `forceAttract` (PoC line
   * crossed / full power / bomb) OR it comes within the magnet radius of the player.
   * Attract items home straight at (px, py). Off-the-bottom (or side) items are culled.
   * Consumes ZERO randomness (position-only).
   */
  update(dt: number, px: number, py: number, forceAttract: boolean): void;
  /** Force every live item into Attract (a bomb / death vacuum). */
  attractAll(): void;
  /** Return to the empty state (used on a fresh run build). */
  clear(): void;
}

/** Field bounds for culling (items leave through the bottom). */
export interface ItemBounds {
  width: number;
  height: number;
  margin: number;
}

export function createItemSystem(bounds: ItemBounds, capacity = 256, cfg: ItemConfig = DEFAULT_ITEM_CONFIG): ItemSystem {
  const pool: Item[] = [];
  for (let i = 0; i < capacity; i++) {
    pool.push({ alive: false, type: 0, x: 0, y: 0, vx: 0, vy: 0, state: ItemState.Falling, age: 0, sprite: 0, r: 0, g: 0, b: 0 });
  }
  let liveCount = 0;
  const { width, height, margin } = bounds;
  // Resolved once (POC line is a fraction of field height); used by `update` below.
  const pocY = PLAYFIELD_H * cfg.pocLineFrac;

  return {
    items: pool,
    get liveCount() {
      return liveCount;
    },
    spawn(o): void {
      for (let i = 0; i < pool.length; i++) {
        const it = pool[i];
        if (it.alive) continue;
        it.alive = true;
        it.type = o.type;
        it.x = o.x;
        it.y = o.y;
        it.vx = o.vx;
        it.vy = o.vy;
        it.state = ItemState.Falling;
        it.age = 0;
        it.sprite = o.sprite;
        it.r = o.r;
        it.g = o.g;
        it.b = o.b;
        liveCount++;
        return;
      }
      // Pool full: drop the new item (deterministic). NOTE: at 256 a bullet-cancel
      // shower (#5) could overrun this — bump the pool or aggregate value there.
    },
    despawn(i): void {
      const it = pool[i];
      if (!it.alive) return;
      it.alive = false;
      liveCount--;
    },
    update(dt, px, py, forceAttract): void {
      const attract = forceAttract || py < pocY;
      const magnet2 = cfg.magnetRadius * cfg.magnetRadius;
      for (let i = 0; i < pool.length; i++) {
        const it = pool[i];
        if (!it.alive) continue;
        it.age++;
        if (it.state === ItemState.Falling) {
          const dx = px - it.x;
          const dy = py - it.y;
          if (attract || dx * dx + dy * dy <= magnet2) {
            it.state = ItemState.Attract; // latched one-way
          }
        }
        if (it.state === ItemState.Attract) {
          // Home straight at the player at a fixed speed.
          const dx = px - it.x;
          const dy = py - it.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          it.vx = (dx / d) * cfg.attractSpeed;
          it.vy = (dy / d) * cfg.attractSpeed;
        } else {
          // Falling: gravity, capped at terminal. Horizontal pop-scatter persists.
          it.vy += cfg.gravity * dt;
          if (it.vy > cfg.terminalVy) it.vy = cfg.terminalVy;
        }
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        // Cull off the bottom or sides (never the top — popped items rise past 0 and
        // fall back). An attracting item homes upward to the player, so it won't fall.
        if (it.y > height + margin || it.x < -margin || it.x > width + margin) {
          it.alive = false;
          liveCount--;
        }
      }
    },
    attractAll(): void {
      for (let i = 0; i < pool.length; i++) {
        if (pool[i].alive) pool[i].state = ItemState.Attract;
      }
    },
    clear(): void {
      for (let i = 0; i < pool.length; i++) pool[i].alive = false;
      liveCount = 0;
    },
  };
}

/**
 * Collect every live item overlapping the player (collection radius) and apply its
 * effect to the player struct. Read + write over the pool, ZERO randomness; mirrors
 * the shot/enemy collision passes. End-of-tick so it reads the FINAL player position
 * (after movement + respawn). No-op while game-over (nothing left to collect into).
 *
 * `maxPower` is the character's power ceiling (derived from its shot config by the
 * sim). A Power item past the ceiling converts to a point; FullPower jumps to it.
 *
 * Returns how many items were collected this tick so the caller can raise a single
 * (batched) presentation event; the count is not read by any hashed logic.
 */
export function stepItemCollection(
  items: ItemSystem,
  player: Player,
  maxPower: number,
  scoring: ScoringConfig,
  itemCfg: ItemConfig,
): number {
  if (player.state === PlayerState.GameOver) return 0;
  const pool = items.items;
  const r2 = itemCfg.collectRadius * itemCfg.collectRadius;
  let collected = 0;
  for (let i = 0; i < pool.length; i++) {
    const it = pool[i];
    if (!it.alive) continue;
    const dx = it.x - player.x;
    const dy = it.y - player.y;
    if (dx * dx + dy * dy > r2) continue;
    applyItem(it.type, player, maxPower, scoring, itemCfg);
    items.despawn(i);
    collected++;
  }
  return collected;
}

/** Height factor for point-item scoring (the PoC mechanic): a point item collected
 *  at or above the PoC line is worth full PIV (factor 1); below, the value scales
 *  down to `PIV_MIN_FACTOR` at the field bottom. Collection homes the item onto the
 *  player, so `y` is the player's y — the height at which it was grabbed. */
function pocHeightFactor(y: number, itemCfg: ItemConfig, scoring: ScoringConfig): number {
  const pocLine = PLAYFIELD_H * itemCfg.pocLineFrac;
  if (y <= pocLine) return 1;
  const t = (y - pocLine) / (PLAYFIELD_H - pocLine); // 0 at the line, 1 at the bottom
  const factor = 1 - t * (1 - scoring.pivMinFactor);
  return factor < scoring.pivMinFactor ? scoring.pivMinFactor : factor;
}

/** Apply one collected item to the player. Pure; the caller despawns the item. */
function applyItem(
  type: ItemType,
  player: Player,
  maxPower: number,
  scoring: ScoringConfig,
  itemCfg: ItemConfig,
): void {
  switch (type) {
    case ItemType.Power:
      if (player.power >= maxPower) {
        // Overflow past max power converts to a point (scored by collection height).
        awardPointItem(player, pocHeightFactor(player.y, itemCfg, scoring), scoring);
      } else {
        player.power = Math.min(maxPower, player.power + itemCfg.powerPerItem);
      }
      break;
    case ItemType.FullPower:
      player.power = maxPower;
      break;
    case ItemType.Life:
      player.lives++;
      break;
    case ItemType.Bomb:
      player.bombs++;
      break;
    case ItemType.Point:
      awardPointItem(player, pocHeightFactor(player.y, itemCfg, scoring), scoring);
      break;
  }
}
