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
}
