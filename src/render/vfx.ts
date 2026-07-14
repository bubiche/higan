// Presentation VFX layer — sparks, screen flash, screen shake.
//
// The visual echo of what the sim just did. It rides the SAME post-step event list as
// audio (`sim.events`, `SfxEvent`): the sim pushes events during `step` (never hashed,
// zero RNG — see core/events.ts), and after the step the shell hands the list to BOTH the
// audio engine and this layer. Audio reads `x`/`n` (pan, intensity); VFX reads `x`/`y` to
// place a burst at the event's playfield point. Nothing here can touch a replay — an event
// push is append-only presentation, and this whole module is downstream of the hash.
//
// Two clocks, like audio's SFX-vs-BGM split:
//   • SPAWN (`consume`) is EVENT-driven and gated by the caller on a real forward advance
//     (the same `driver.tick > t0` guard audio uses), so a scrub / replay-rebuild that jumps
//     many ticks in one frame fires at most one burst — never a machine-gun.
//   • DECAY (`update`) runs every real frame on wall time (the presentation clock), so
//     sparks fade and the shake settles smoothly regardless of the sim's fixed timestep.
//     Because decay is unconditional, the shake self-resets to zero whenever no new trigger
//     arrives — the caller never has to clean up a stuck offset.
//
// `Math.random` is used freely for burst spread/velocity: this is presentation, wholly
// outside the deterministic core (the sim's seeded PRNG is a different world). GL lives only
// inside `createVfx`; the module is import-safe with no WebGL/DOM context.

import { INSTANCE_FLOATS, type BulletRenderer } from "./bullets";
import { createProgram } from "./gl";
import { Shape } from "./shapes";
import { SfxId, type SfxEvent } from "../core/events";
import { PLAYFIELD_W, PLAYFIELD_H } from "../core/playfield";

/** Max live spark particles. A death burst is ~10, a pichuun ring ~24; bursts are capped so
 *  even a bomb that cancels thousands of bullets spawns a bounded sparkle, not thousands of
 *  quads. Overflow drops the newest — the pool never grows the frame cost. */
const MAX_PARTICLES = 512;

/** Shake wobble frequencies (rad/s) — two incommensurate rates so the offset traces a jittery
 *  Lissajous rather than a clean circle. */
const SHAKE_FX = 51;
const SHAKE_FY = 43;

/** The stateful VFX layer. Owned by the shell (one GL program, reused across runs) and driven
 *  by the in-game screen. Presentation-only — never enters the sim. */
export interface VfxLayer {
  /** Spawn bursts / flash / shake from a stepped tick's events. Call ONLY on a real forward
   *  advance (`driver.tick > t0`), mirroring the audio-event gate — otherwise a scrub or a
   *  replay-rebuild would machine-gun the same burst. */
  consume(events: readonly SfxEvent[]): void;
  /** Advance decay/motion by real elapsed seconds. Call every frame (unconditionally), so
   *  sparks fade and the shake settles even on idle/paused frames — and so the shake offset
   *  returns to zero on its own. */
  update(dtSec: number): void;
  /** Clear all live VFX (a fresh run shouldn't inherit the previous run's sparks/shake). */
  reset(): void;
  /** Current screen-shake offset in SIM UNITS (x, y); `[0, 0]` once settled. The caller turns
   *  it into a `gl.viewport` offset so the whole field shakes as one — see app.ts. */
  shakeOffset(): readonly [number, number];
  /** Draw the live sparks as additive glow, reusing the bullet program + shape atlas (the same
   *  path player shots / the hitbox marker take). Issue AFTER the danmaku draw so bursts read
   *  on top; it reuses the bullet instance buffer, so it must precede any later draw that
   *  overwrites it. A no-op when no particles are live. */
  drawParticles(bullets: BulletRenderer): void;
  /** Draw the full-field flash/fade quad over everything (drawn LAST). A no-op when clear. */
  drawFlash(): void;
}

// Full-field solid-colour quad for the flash. A clip-space quad (no viewport transform — it
// always covers the field) painted at `uColor` with straight-alpha blend, so a white flash
// washes the field and fades as its alpha decays.
const FLASH_VS = `#version 300 es
layout(location=0) in vec2 aPos;   // clip-space corners (-1..1)
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FLASH_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 frag;
void main() { frag = uColor; }`;

export function createVfx(gl: WebGL2RenderingContext): VfxLayer {
  // ── Particle pool (SoA, dense prefix [0, count)) ────────────────────────────────
  const px = new Float32Array(MAX_PARTICLES);
  const py = new Float32Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES);
  const cr = new Float32Array(MAX_PARTICLES);
  const cg = new Float32Array(MAX_PARTICLES);
  const cb = new Float32Array(MAX_PARTICLES);
  const life = new Float32Array(MAX_PARTICLES); // seconds remaining
  const life0 = new Float32Array(MAX_PARTICLES); // seconds at spawn (for the fade fraction)
  const ang = new Float32Array(MAX_PARTICLES); // fixed orientation (stars/kunai want variety)
  const shp = new Float32Array(MAX_PARTICLES); // atlas layer (Shape)
  const drag = new Float32Array(MAX_PARTICLES); // per-sec velocity decay (spark ease-out)
  let count = 0;

  const instData = new Float32Array(MAX_PARTICLES * INSTANCE_FLOATS);

  const spawn = (
    x: number,
    y: number,
    vxi: number,
    vyi: number,
    sz: number,
    r: number,
    g: number,
    b: number,
    lifeSec: number,
    shape: number,
    angle: number,
    dragPerSec: number,
  ): void => {
    if (count >= MAX_PARTICLES) return; // pool full — drop the newest, never grow the cost
    const i = count++;
    px[i] = x;
    py[i] = y;
    vx[i] = vxi;
    vy[i] = vyi;
    size[i] = sz;
    cr[i] = r;
    cg[i] = g;
    cb[i] = b;
    life[i] = lifeSec;
    life0[i] = lifeSec;
    ang[i] = angle;
    shp[i] = shape;
    drag[i] = dragPerSec;
  };

  /** Spawn `n` particles radiating from (x, y): random direction, speed in [smin, smax], life
   *  in [lmin, lmax], colour jittered toward white. `spin` randomises orientation. */
  const burst = (
    x: number,
    y: number,
    n: number,
    smin: number,
    smax: number,
    sz: number,
    r: number,
    g: number,
    b: number,
    lmin: number,
    lmax: number,
    shape: number,
    dragPerSec: number,
  ): void => {
    for (let k = 0; k < n; k++) {
      const dir = Math.random() * Math.PI * 2;
      const sp = smin + Math.random() * (smax - smin);
      const l = lmin + Math.random() * (lmax - lmin);
      // Bias each spark a touch toward white so bursts read as bright, not flat colour.
      const w = 0.15 * Math.random();
      spawn(
        x,
        y,
        Math.cos(dir) * sp,
        Math.sin(dir) * sp,
        sz * (0.7 + Math.random() * 0.6),
        r + (1 - r) * w,
        g + (1 - g) * w,
        b + (1 - b) * w,
        l,
        shape,
        Math.random() * Math.PI * 2,
        dragPerSec,
      );
    }
  };

  // ── Flash state ─────────────────────────────────────────────────────────────────
  let flashA = 0;
  let flashR = 1;
  let flashG = 1;
  let flashB = 1;
  let flashRate = 0; // alpha units per second

  const flash = (r: number, g: number, b: number, peak: number, durSec: number): void => {
    if (peak > flashA) {
      flashA = peak;
      flashR = r;
      flashG = g;
      flashB = b;
    }
    flashRate = peak / durSec;
  };

  // ── Shake state ───────────────────────────────────────────────────────────────
  let shakeMag = 0; // initial amplitude (sim units)
  let shakeT = 0; // seconds remaining
  let shakeDur = 0; // total duration (for the linear ramp-down)
  let shakeElapsed = 0; // seconds since this shake started (drives the wobble phase)

  const shake = (mag: number, durSec: number): void => {
    // Last shake wins if it's at least as strong as what's currently left — bombs/deaths are
    // infrequent, so a simple replace avoids stacking into an ever-growing jolt.
    const remaining = shakeT > 0 ? shakeMag * (shakeT / shakeDur) : 0;
    if (mag >= remaining) {
      shakeMag = mag;
      shakeDur = durSec;
      shakeT = durSec;
      shakeElapsed = 0;
    }
  };

  // ── Flash GL program (a full-field quad) ────────────────────────────────────────
  const flashProg = createProgram(gl, FLASH_VS, FLASH_FS);
  const uColor = gl.getUniformLocation(flashProg, "uColor");
  const flashVao = gl.createVertexArray();
  gl.bindVertexArray(flashVao);
  const flashBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, flashBuf);
  // Corners overshoot the clip cube (±1.1, not ±1) so the flash still covers the whole canvas
  // when a co-firing shake has slid the GL viewport: a bomb/pichuun fires flash + shake
  // together, the shake offsets the viewport, and a tight ±1 quad would leave a ~few-pixel
  // strip at the shifted edge showing the clear colour through. Max shake is ~7 sim units of
  // 384 → NDC overshoot ~0.04, so ±1.1 is ample; the excess is clipped on the covered side.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1.1, -1.1, 1.1, -1.1, -1.1, 1.1, 1.1, 1.1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    consume(events): void {
      for (const e of events) {
        const x = e.x ?? PLAYFIELD_W / 2;
        const y = e.y ?? PLAYFIELD_H / 2;
        switch (e.id) {
          case SfxId.EnemyDeath:
            // A warm-white pop where the enemy died.
            burst(x, y, 10, 40, 95, 2.2, 1.0, 0.95, 0.85, 0.28, 0.42, Shape.BigOrb, 3.5);
            break;
          case SfxId.Cancel: {
            // Bullet-cancel sparkle — cyan-white stars, more of them the bigger the cancel,
            // but capped so a full-field bomb clear doesn't flood the pool.
            const n = Math.min(8 + ((e.n ?? 0) >> 4), 28);
            burst(x, y, n, 60, 150, 2.6, 0.55, 0.9, 1.0, 0.35, 0.6, Shape.Star, 2.2);
            break;
          }
          case SfxId.EnemyHit:
            // Chip feedback where shots land — on popcorn AND the boss. Kept tiny + brief so
            // the near-every-tick stream while damaging the boss reads as a shimmer, not clutter
            // (the bigger EnemyDeath pop is the kill). Yellow-white flecks.
            burst(x, y, 2, 25, 70, 1.2, 1.0, 0.95, 0.55, 0.12, 0.2, Shape.Orb, 5);
            break;
          case SfxId.Graze:
            // A small, quick blue-white flick at the player as a bullet skims by.
            burst(x, y, 4, 30, 80, 1.6, 0.6, 0.8, 1.0, 0.18, 0.3, Shape.Orb, 4);
            break;
          case SfxId.ItemCollect: {
            // A gentle gold twinkle rising off the player as items are absorbed.
            const n = Math.min(2 + (e.n ?? 1), 8);
            burst(x, y, n, 20, 55, 1.8, 1.0, 0.85, 0.35, 0.28, 0.42, Shape.Star, 3);
            break;
          }
          case SfxId.Pichuun:
            // Player death: the classic pichuun burst — a bright ring, a brief flash, a jolt.
            burst(x, y, 24, 80, 165, 3.0, 0.85, 0.92, 1.0, 0.45, 0.7, Shape.BigOrb, 2);
            flash(1.0, 0.95, 0.95, 0.32, 0.3);
            shake(4, 0.35);
            break;
          case SfxId.Bomb:
          case SfxId.PlayerDeathBomb:
            // A bomb whites the field and shakes it, with a burst at the origin.
            burst(x, y, 16, 70, 150, 3.2, 0.9, 0.95, 1.0, 0.4, 0.6, Shape.BigOrb, 2);
            flash(1.0, 1.0, 1.0, 0.5, 0.4);
            shake(7, 0.4);
            break;
          case SfxId.SpellDeclare:
            // Spell-card declaration: a soft cyan wash announces it (the DOM cut-in + banner
            // and the GL spell-tint carry the rest). SpellDeclare carries no x/y, so this
            // washes from the field centre — a full-field flash, so the origin is irrelevant.
            flash(0.7, 0.85, 1.0, 0.3, 0.5);
            break;
          case SfxId.SpellCapture:
            // Capture: a bright gold pop + a star sparkle burst at centre (the DOM flourish
            // names it). No shake — capture is a reward beat, not an impact.
            burst(x, y, 18, 70, 150, 2.8, 1.0, 0.9, 0.5, 0.4, 0.65, Shape.Star, 2.2);
            flash(1.0, 0.95, 0.75, 0.36, 0.55);
            break;
          default:
            break; // Shoot / EnemyShoot / Laser / Extend / UI — no VFX here
        }
      }
    },

    update(dtSec): void {
      // Particles: integrate, apply drag (ease-out), age out. Swap-remove keeps [0, count) dense.
      for (let i = 0; i < count; i++) {
        life[i] -= dtSec;
        if (life[i] <= 0) {
          const last = --count;
          px[i] = px[last];
          py[i] = py[last];
          vx[i] = vx[last];
          vy[i] = vy[last];
          size[i] = size[last];
          cr[i] = cr[last];
          cg[i] = cg[last];
          cb[i] = cb[last];
          life[i] = life[last];
          life0[i] = life0[last];
          ang[i] = ang[last];
          shp[i] = shp[last];
          drag[i] = drag[last];
          i--; // re-test the swapped-in particle
          continue;
        }
        const d = Math.max(0, 1 - drag[i] * dtSec);
        vx[i] *= d;
        vy[i] *= d;
        px[i] += vx[i] * dtSec;
        py[i] += vy[i] * dtSec;
      }
      // Flash + shake decay on the same wall clock.
      if (flashA > 0) flashA = Math.max(0, flashA - flashRate * dtSec);
      if (shakeT > 0) {
        shakeT -= dtSec;
        shakeElapsed += dtSec;
      }
    },

    reset(): void {
      count = 0;
      flashA = 0;
      shakeT = 0;
      shakeElapsed = 0;
    },

    shakeOffset(): readonly [number, number] {
      if (shakeT <= 0) return [0, 0];
      const amp = shakeMag * (shakeT / shakeDur); // linear ramp-down
      return [amp * Math.sin(shakeElapsed * SHAKE_FX), amp * Math.cos(shakeElapsed * SHAKE_FY)];
    },

    drawParticles(bullets): void {
      if (count === 0) return;
      let o = 0;
      for (let i = 0; i < count; i++) {
        // Additive glow fades by dimming the colour toward black as life runs out (the FS
        // multiplies texture alpha by this colour), and shrinks the quad a touch.
        const f = life[i] / life0[i];
        instData[o] = px[i];
        instData[o + 1] = py[i];
        instData[o + 2] = size[i] * (0.5 + 0.5 * f);
        instData[o + 3] = ang[i];
        instData[o + 4] = cr[i] * f;
        instData[o + 5] = cg[i] * f;
        instData[o + 6] = cb[i] * f;
        instData[o + 7] = shp[i];
        o += INSTANCE_FLOATS;
      }
      bullets.drawInstances(instData, count);
    },

    drawFlash(): void {
      if (flashA <= 0.001) return;
      gl.useProgram(flashProg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // straight alpha — a wash over the field
      // Un-premultiplied RGB: SRC_ALPHA blend multiplies by alpha itself, so passing the raw
      // colour + alpha gives result = rgb·a + dst·(1−a), a correct wash (premultiplying here
      // would darken it by a second factor of alpha).
      gl.uniform4f(uColor, flashR, flashG, flashB, flashA);
      gl.bindVertexArray(flashVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    },
  };
}
