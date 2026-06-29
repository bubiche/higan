// xorshift128 — small, fast, fully seeded. The deterministic-sim hard rule
// forbids Math.random() in the update path, so all randomness flows through here.
export class Rng {
  private x: number;
  private y: number;
  private z: number;
  private w: number;

  constructor(seed: number) {
    // Splitmix-style scramble so a small integer seed fills all four lanes.
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.x = next() || 1;
    this.y = next();
    this.z = next();
    this.w = next();
  }

  // Uint32.
  u32(): number {
    const t = this.x ^ (this.x << 11);
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.w;
  }

  // [0,1)
  f(): number {
    return this.u32() / 0x100000000;
  }

  // [min,max)
  range(min: number, max: number): number {
    return min + this.f() * (max - min);
  }

  /**
   * The four-word internal state. Folded into the determinism hash as a direct
   * tripwire for a stream-ordering desync, and read by the RNG-isolation check: a
   * protected stream's state must evolve as a pure function of (seed, tick) and
   * never depend on player input, so two runs that differ only in input must leave
   * this identical at any tick before an HP-driven phase transition.
   */
  snapshot(): readonly [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }
}

/**
 * Mix two integers into a well-distributed u32 seed. Used to derive uncorrelated
 * per-stage seeds from the master run seed (`mixSeed(runSeed, stageIndex)`) and
 * per-stream seeds from a stage seed (`mixSeed(stageSeed, streamId)`) — mixed, not
 * added, so neighbouring indices don't produce neighbouring seeds. Same splitmix
 * scramble the constructor uses to fill its lanes.
 */
export function mixSeed(a: number, b: number): number {
  let s = (Math.imul(a >>> 0, 0x9e3779b9) ^ (b >>> 0)) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97) >>> 0;
  return (s ^ (s >>> 15)) >>> 0;
}
