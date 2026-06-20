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
} as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

/** Number of atlas layers. Drawers below must be listed in `Shape` order. */
export const SHAPE_COUNT = 6;

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
];
