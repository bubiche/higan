// Player-shot pool — the player's offensive bullets.
//
// Like the laser (and unlike enemy bullets), player shots are O(tens–hundreds), so
// the dumb-data SoA rule does NOT apply: the rule exists for O(10k) bullets' cache
// locality (Hard Rule 1). A shot is a plain object in a fixed pre-allocated pool,
// iterated in pool order; the sim packs the live ones into a scratch Float32Array
// at hash time exactly the way it compacts live bullet slots and laser beams.
//
// Determinism (Hard Rule 2): firing is a pure function of (tick, input, power) and
// shots move linearly — the whole module consumes ZERO randomness. So the player
// shooting never perturbs any danmaku RNG stream, and every existing pattern keeps
// replaying byte-identically (design note §c — the same discipline that kept M4's
// player/collision out of the rng).
//
// The shot DEFINITION (cadence, spread, damage, sprite) is authored CONTENT on a
// character; only the pool / firing / collision SYSTEM is engine. A different game
// defines a different shot with zero changes here.

import type { InputFrame } from "../core/input";
import { PlayerState, type Player } from "./player";

/** A single player shot. Mutated in place inside its pool slot. */
export interface Shot {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks since spawn. */
  age: number;
  /** Damage dealt to a target on hit (sim state — affects the hashed boss HP). */
  damage: number;
  /** Collision + draw radius (sim state — sets the hit threshold). */
  radius: number;
  /** Shape atlas layer — render-only (not hashed), like a laser's colour. */
  sprite: number;
  /** Linear RGB tint, 0..1 — render-only. */
  r: number;
  g: number;
  b: number;
}

/** Spawn parameters — every field explicit; defaulting happens at the fire layer. */
export interface ShotSpawn {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  sprite: number;
  r: number;
  g: number;
  b: number;
}

/**
 * A character's shot definition — authored content, referenced by `CharacterDef`.
 * Construction input (like `PlayerConfig`): it feeds deterministic firing but the
 * object itself is not in the hash.
 */
export interface ShotConfig {
  /** Ticks between volleys while `shoot` is held. */
  readonly fireInterval: number;
  /** Shot speed, sim units / second (travels upward). */
  readonly speed: number;
  /** Damage per shot on hit. */
  readonly damage: number;
  /** Collision + draw radius, sim units. */
  readonly radius: number;
  /** Shape atlas layer for the (placeholder) sprite. */
  readonly sprite: number;
  /** Linear RGB tint. */
  readonly color: readonly [number, number, number];
  /** Streams per volley at power 0. */
  readonly baseStreams: number;
  /** Power units that add one more stream (until `maxStreams`). */
  readonly powerPerStream: number;
  /** Hard cap on streams per volley. */
  readonly maxStreams: number;
  /** Half-arc of the UNFOCUSED fan, radians (centred on straight-up). */
  readonly spread: number;
  /** Focus narrows the fan to this fraction of `spread` — the concentrated shot. */
  readonly focusSpreadFrac: number;
}

/** Default shot; a game overrides per character. Tuned so a centred, focused
 *  player drains the demo boss at roughly the old `shotDps` stub's rate. */
export const DEFAULT_SHOT_CONFIG: ShotConfig = {
  fireInterval: 4,
  speed: 620,
  damage: 9,
  radius: 5,
  sprite: 4, // Kunai — a needle; the renderer rotates it along travel (points up)
  color: [0.6, 0.85, 1.0],
  baseStreams: 2,
  powerPerStream: 1,
  maxStreams: 6,
  spread: 0.22,
  focusSpreadFrac: 0.18,
};

/** A circular target a shot can hit (the boss now; enemies in the next sub-task). */
export interface HitTarget {
  x: number;
  y: number;
  radius: number;
}

export interface ShotSystem {
  /** The fixed pool; iterate `[0, shots.length)` and skip `!alive` slots. */
  readonly shots: readonly Shot[];
  /** Number of live shots. */
  readonly liveCount: number;
  /** Spawn a shot. A no-op (drop) if the pool is full — deterministic. */
  spawn(o: ShotSpawn): void;
  /** Despawn the shot in slot `i` (used by collision when a shot connects). */
  despawn(i: number): void;
  /** Advance every live shot one fixed step and cull off-field ones. */
  update(dt: number): void;
  /** Return to the empty state (used on a fresh run build). */
  clear(): void;
}

/** Field bounds for culling (shots leave through the top). */
export interface ShotBounds {
  width: number;
  height: number;
  margin: number;
}

export function createShotSystem(bounds: ShotBounds, capacity = 256): ShotSystem {
  const pool: Shot[] = [];
  for (let i = 0; i < capacity; i++) {
    pool.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, damage: 0, radius: 0, sprite: 0, r: 0, g: 0, b: 0 });
  }
  let liveCount = 0;
  const { width, height, margin } = bounds;

  return {
    shots: pool,
    get liveCount() {
      return liveCount;
    },
    spawn(o): void {
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (s.alive) continue;
        s.alive = true;
        s.x = o.x;
        s.y = o.y;
        s.vx = o.vx;
        s.vy = o.vy;
        s.damage = o.damage;
        s.radius = o.radius;
        s.sprite = o.sprite;
        s.r = o.r;
        s.g = o.g;
        s.b = o.b;
        s.age = 0;
        liveCount++;
        return;
      }
      // Pool full: drop the new shot (deterministic). At O(hundreds) capacity with a
      // fast cull off the top, this realistically never trips.
    },
    despawn(i): void {
      const s = pool[i];
      if (!s.alive) return;
      s.alive = false;
      liveCount--;
    },
    update(dt): void {
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (!s.alive) continue;
        s.age++;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.y < -margin || s.y > height + margin || s.x < -margin || s.x > width + margin) {
          s.alive = false;
          liveCount--;
        }
      }
    },
    clear(): void {
      for (let i = 0; i < pool.length; i++) pool[i].alive = false;
      liveCount = 0;
    },
  };
}

/**
 * Fire a volley this tick if `shoot` is held, the player can fire, and the tick is
 * on the cadence. ZERO randomness — deterministic cadence (`tick % fireInterval`)
 * and fixed angles, so firing never perturbs any pattern's RNG stream (§c).
 *
 * Streams scale with power (flat until items feed power); focus collapses the fan
 * to a narrow column (high single-target DPS), unfocus stays a wide spread. With a
 * narrow focus fan every shot lands on a centred boss, so focus out-damages unfocus
 * *emergently* — no separate focus-damage knob needed.
 *
 * Returns whether a volley fired this tick (one per cadence tick, regardless of stream
 * count) so the caller can raise a single presentation event. The return is not read by
 * any hashed logic — firing stays a pure, zero-RNG function of (tick, input, power).
 */
export function fireShots(
  system: ShotSystem,
  player: Player,
  input: InputFrame,
  cfg: ShotConfig,
  tick: number,
): boolean {
  if (!input.shoot) return false;
  if (player.state !== PlayerState.Alive && player.state !== PlayerState.Respawning) return false;
  if (tick % cfg.fireInterval !== 0) return false;

  const streams = Math.min(cfg.maxStreams, cfg.baseStreams + Math.floor(player.power / cfg.powerPerStream));
  const halfArc = (player.focused ? cfg.focusSpreadFrac : 1) * cfg.spread;
  const up = -Math.PI / 2; // straight up: the field is y-down, so up is -y
  const r = cfg.color[0];
  const g = cfg.color[1];
  const b = cfg.color[2];
  for (let i = 0; i < streams; i++) {
    // Evenly fan across [up - halfArc, up + halfArc]; a single stream goes dead up.
    const t = streams === 1 ? 0.5 : i / (streams - 1);
    const a = up - halfArc + t * (2 * halfArc);
    system.spawn({
      x: player.x,
      y: player.y,
      vx: Math.cos(a) * cfg.speed,
      vy: Math.sin(a) * cfg.speed,
      damage: cfg.damage,
      radius: cfg.radius,
      sprite: cfg.sprite,
      r,
      g,
      b,
    });
  }
  return true;
}

/**
 * Despawn live shots whose disc overlaps `target` and return the total damage they
 * dealt. A null target (no active boss/enemy) leaves shots untouched — they keep
 * flying and cull off the top. Read + write over the pool, ZERO randomness; the
 * caller applies the returned damage to the hashed target HP.
 */
export function stepShotCollision(system: ShotSystem, target: HitTarget | null): number {
  if (!target) return 0;
  const { shots } = system;
  let dealt = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (!s.alive) continue;
    const dx = s.x - target.x;
    const dy = s.y - target.y;
    const thr = s.radius + target.radius;
    if (dx * dx + dy * dy <= thr * thr) {
      dealt += s.damage;
      system.despawn(i);
    }
  }
  return dealt;
}
