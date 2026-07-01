// The reference game's sprite library — placeholder procedural art behind the loader slots.
//
// Every sprite here is a `procedural` stand-in: a canvas drawer, no image files. Dropping
// in real art later is a one-line-per-entry swap (`{ kind: "procedural", draw }` →
// `{ kind: "url", src }`); nothing else in the game or engine changes. The shapes are drawn
// mostly WHITE so the per-instance tint (an enemy's `color`, the player's marker colour)
// colours them at draw time — the same tinting the glow bullets already use, so the
// existing amber/teal/rose enemy colour-coding survives the move to sprites for free.
//
// This is also the DX example: one `defineSprites` block names the game's art; the handles
// it returns are referenced inline in the patterns (typed, autocompleted, typo-caught) and
// the whole map is handed to `assets.sprites.library` so the loader preloads + atlases it.

import { defineSprites, type ImageSource } from "higan";

// ── procedural drawers ──────────────────────────────────────────────────────────
// Each paints a `size × size` alpha canvas centred on the middle. `frame`/`frames` drive
// sprite-sheet animation (the loader calls the drawer once per frame → consecutive atlas
// layers); a static drawer ignores them.

/** A small fairy: a round body + head, with two wings that flap across the frames. */
const fairy: ImageSource = {
  kind: "procedural",
  draw(ctx, size, frame, frames) {
    const c = size / 2;
    const r = size * 0.16;
    // Wing flap: fully spread at frame 0, folded at the midpoint, back out — a sine over
    // the loop so frame N wraps smoothly to frame 0.
    const flap = 0.5 + 0.5 * Math.cos((frame / frames) * Math.PI * 2); // 1→0→1
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    // Wings (behind the body): two ellipses whose vertical stretch tracks the flap.
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(c + s * r * 0.9, c - r * 0.2);
      ctx.rotate(s * (0.5 + flap * 0.6));
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.4, r * (0.5 + flap), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Body + head.
    ctx.beginPath();
    ctx.arc(c, c + r * 0.4, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c, c - r * 0.7, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  },
};

/** A tankier sentinel: a hexagonal shell around a bright core (static). */
const sentinel: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const R = size * 0.34;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = c + Math.cos(a) * R;
      const y = c + Math.sin(a) * R;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.beginPath();
    ctx.arc(c, c, R * 0.42, 0, Math.PI * 2);
    ctx.fill();
  },
};

/** The player craft: a small upward arrowhead with a cockpit dot (static). */
const player: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const R = size * 0.34;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(c, c - R); // nose
    ctx.lineTo(c + R * 0.8, c + R * 0.8); // right tail
    ctx.lineTo(c, c + R * 0.35); // notch
    ctx.lineTo(c - R * 0.8, c + R * 0.8); // left tail
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(140,190,255,1)";
    ctx.beginPath();
    ctx.arc(c, c - R * 0.15, R * 0.22, 0, Math.PI * 2);
    ctx.fill();
  },
};

/**
 * The game's sprite handles. Referenced inline in the patterns (`sprite: demoSprites.fairy`)
 * and handed whole to `assets.sprites.library`. Placeholders now; swap any `source` to a
 * `{ kind: "url", src }` for real art with no other change.
 */
export const demoSprites = defineSprites({
  fairy: { source: fairy, frames: 4, fps: 10 }, // popcorn + sweepers (tinted per enemy)
  sentinel: { source: sentinel }, // the tankier turrets
  player: { source: player },
});
