// Procedural bullet shapes.
//
// A few distinct shapes, generated at startup (no image assets — zero licensing
// risk, fully deterministic visuals, swappable for real sprites later with no API
// change). Each is drawn white on transparent; the renderer tints per-bullet via
// the instance colour and additive blend.
//
// This module is DOM-free at load (the drawers take a 2D context as a parameter;
// the canvas itself is created by the atlas builder in `gl.ts`), so the authoring
// API can import `Shape` without pulling in any browser surface.
//
// Orientation convention: non-round shapes (rice, kunai) are drawn pointing along
// +x (the texture's horizontal axis). The renderer rotates each quad by the
// bullet's `angle` (0 = +x), so they point along travel with no extra offset.

/** Shape index carried per bullet (`store.sprite`) and used as the atlas layer. */
export const Shape = {
  Orb: 0,
  Rice: 1,
  Oval: 2,
  BigOrb: 3,
  Kunai: 4,
  Star: 5,
  Ofuda: 6,
  Scale: 7,
  Crystal: 8,
  Bubble: 9,
  Heart: 10,
  Butterfly: 11,
  /** Not a bullet shape a game selects — the soft bloom the renderer stacks over a
   *  just-spawned bullet for the spawn flash (see `marshalBullets`). Kept in the same
   *  atlas so it draws in the one additive glow call. */
  Flare: 12,
} as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

/** Number of atlas layers. Drawers below must be listed in `Shape` order. */
export const SHAPE_COUNT = 13;

type Drawer = (ctx: CanvasRenderingContext2D, size: number) => void;

/** A soft radial disc that fades to transparent at `r` — the danmaku glow core. */
function softDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0.0, "rgba(255,255,255,1.0)");
  g.addColorStop(0.4, "rgba(255,255,255,0.9)");
  g.addColorStop(0.75, "rgba(255,255,255,0.35)");
  g.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw `softDisc` scaled into an ellipse (sx, sy stretch about the centre). */
function softEllipse(ctx: CanvasRenderingContext2D, size: number, sx: number, sy: number, r: number): void {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(sx, sy);
  softDisc(ctx, 0, 0, r);
  ctx.restore();
}

/** A hollow ring: bright at the rim, near-empty in the middle (the "bubble" orb). */
function softRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0.0, "rgba(255,255,255,0.12)");
  g.addColorStop(0.55, "rgba(255,255,255,0.08)");
  g.addColorStop(0.82, "rgba(255,255,255,1.0)");
  g.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A crisp white filled ellipse with a soft glow halo (a wing lobe / body). */
function glowEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
): void {
  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = 5;
  ctx.fillStyle = "rgba(255,255,255,1.0)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A crisp white polygon with a soft glow halo, for the hard-edged shapes. */
function glowPoly(ctx: CanvasRenderingContext2D, pts: readonly [number, number][]): void {
  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "rgba(255,255,255,1.0)";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** One drawer per shape, indexed by `Shape`. Each fills a `size`×`size` cell. */
export const SHAPE_DRAWERS: readonly Drawer[] = [
  // Orb — the default soft round bullet.
  (ctx, s) => softDisc(ctx, s / 2, s / 2, s * 0.42),
  // Rice — a thin grain elongated along +x.
  (ctx, s) => softEllipse(ctx, s, 1.7, 0.5, s * 0.3),
  // Oval — a fat ellipse, wider than tall.
  (ctx, s) => softEllipse(ctx, s, 1.35, 0.85, s * 0.34),
  // BigOrb — a larger disc with a brighter core.
  (ctx, s) => {
    softDisc(ctx, s / 2, s / 2, s * 0.5);
    softDisc(ctx, s / 2, s / 2, s * 0.26);
  },
  // Kunai — a dart pointing +x (tip right, notched tail left).
  (ctx, s) =>
    glowPoly(ctx, [
      [s * 0.94, s * 0.5],
      [s * 0.42, s * 0.3],
      [s * 0.2, s * 0.5],
      [s * 0.42, s * 0.7],
    ]),
  // Star — a 5-point star.
  (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    const outer = s * 0.46;
    const inner = s * 0.2;
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      // Start at the top (-y); 5 points.
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    glowPoly(ctx, pts);
  },
  // Ofuda — a rectangular talisman/card elongated along +x (travels long-edge first).
  (ctx, s) =>
    glowPoly(ctx, [
      [s * 0.2, s * 0.34],
      [s * 0.8, s * 0.34],
      [s * 0.8, s * 0.66],
      [s * 0.2, s * 0.66],
    ]),
  // Scale — a compact rounded diamond/kite, the common mid-density filler.
  (ctx, s) =>
    glowPoly(ctx, [
      [s * 0.8, s * 0.5],
      [s * 0.5, s * 0.3],
      [s * 0.2, s * 0.5],
      [s * 0.5, s * 0.7],
    ]),
  // Crystal — a long, sharp shard pointing +x (thinner and longer than the scale).
  (ctx, s) =>
    glowPoly(ctx, [
      [s * 0.92, s * 0.5],
      [s * 0.5, s * 0.4],
      [s * 0.08, s * 0.5],
      [s * 0.5, s * 0.6],
    ]),
  // Bubble — a large hollow/outlined orb (the "soul" ball).
  (ctx, s) => softRing(ctx, s / 2, s / 2, s * 0.48),
  // Heart — tip drawn toward +x so velocity-rotation makes a falling heart point
  // down (the Touhou convention). Built from two bezier lobes about the +x axis.
  (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    const a = s * 0.36;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2); // upright (tip-down) heart → tip points +x
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(255,255,255,1.0)";
    ctx.beginPath();
    ctx.moveTo(0, a * 0.6); // bottom tip
    ctx.bezierCurveTo(a * 1.1, -a * 0.1, a * 0.55, -a * 0.95, 0, -a * 0.35);
    ctx.bezierCurveTo(-a * 0.55, -a * 0.95, -a * 1.1, -a * 0.1, 0, a * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  // Butterfly — a static silhouette (the atlas is single-frame, so it can't flap;
  // best fired large + slow as a spell bullet). Body along +x, two wing pairs.
  (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    glowEllipse(ctx, cx + s * 0.12, cy - s * 0.16, s * 0.24, s * 0.17, -0.4); // fore, upper
    glowEllipse(ctx, cx + s * 0.12, cy + s * 0.16, s * 0.24, s * 0.17, 0.4); // fore, lower
    glowEllipse(ctx, cx - s * 0.16, cy - s * 0.12, s * 0.18, s * 0.13, 0.4); // hind, upper
    glowEllipse(ctx, cx - s * 0.16, cy + s * 0.12, s * 0.18, s * 0.13, -0.4); // hind, lower
    glowEllipse(ctx, cx, cy, s * 0.28, s * 0.05, 0); // body
  },
  // Flare — a wide soft bloom filling the cell, brighter and gentler-falloff than Orb, so
  // scaled up and stacked additively it reads as a burst of light rather than a bigger
  // bullet. Never selected by a game (see `Shape.Flare`); only the spawn-flash pass draws it.
  (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0.0, "rgba(255,255,255,1.0)");
    g.addColorStop(0.28, "rgba(255,255,255,0.55)");
    g.addColorStop(0.62, "rgba(255,255,255,0.16)");
    g.addColorStop(1.0, "rgba(255,255,255,0.0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
  },
];
