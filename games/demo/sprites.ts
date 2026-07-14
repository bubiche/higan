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

/** The stage-1 boss: a robed gatekeeper — a bell-shaped robe, a head, and a halo ring
 *  behind it, so a large stern figure reads at the boss origin (static). Drawn white; the
 *  encounter's tint colours it. */
const gatekeeperBody: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const R = size * 0.42;
    // Halo ring behind the figure.
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    ctx.arc(c, c - R * 0.35, R * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    // Robe: a bell from the shoulders to a wide hem.
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.moveTo(c - R * 0.28, c - R * 0.35);
    ctx.quadraticCurveTo(c - R, c + R, c - R * 0.95, c + R);
    ctx.lineTo(c + R * 0.95, c + R);
    ctx.quadraticCurveTo(c + R, c + R, c + R * 0.28, c - R * 0.35);
    ctx.closePath();
    ctx.fill();
    // Head.
    ctx.beginPath();
    ctx.arc(c, c - R * 0.55, R * 0.28, 0, Math.PI * 2);
    ctx.fill();
    // A brighter core sash across the robe.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(c - R * 0.5, c + R * 0.1, R, R * 0.16);
  },
};

/** The stage-2 boss: a songstress — a slender gowned figure with two swept plumes and a
 *  small flame crest, echoing her portrait (static). Drawn white; the encounter's tint
 *  colours it. */
const songstressBody: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const R = size * 0.42;
    // Two swept plumes behind the shoulders.
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(c, c - R * 0.2);
      ctx.quadraticCurveTo(c + s * R * 1.1, c - R * 0.9, c + s * R * 1.15, c + R * 0.15);
      ctx.quadraticCurveTo(c + s * R * 0.7, c - R * 0.2, c, c + R * 0.1);
      ctx.closePath();
      ctx.fill();
    }
    // Gown: a narrow waist flaring to the hem.
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.moveTo(c - R * 0.18, c - R * 0.3);
    ctx.quadraticCurveTo(c - R * 0.75, c + R, c - R * 0.6, c + R);
    ctx.lineTo(c + R * 0.6, c + R);
    ctx.quadraticCurveTo(c + R * 0.75, c + R, c + R * 0.18, c - R * 0.3);
    ctx.closePath();
    ctx.fill();
    // Head.
    ctx.beginPath();
    ctx.arc(c, c - R * 0.5, R * 0.24, 0, Math.PI * 2);
    ctx.fill();
    // Flame crest above the head (three tongues).
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (const dx of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(c + dx * R * 0.18, c - R * 0.72);
      ctx.quadraticCurveTo(c + dx * R * 0.28, c - R * 1.0, c + dx * R * 0.1, c - R * 1.05);
      ctx.quadraticCurveTo(c + dx * R * 0.02, c - R * 0.85, c + dx * R * 0.18, c - R * 0.72);
      ctx.fill();
    }
  },
};

/** The stage-3 boss: the Nocturne Sovereign — a regal gowned figure with a swept veil
 *  behind and a small three-point star crown, so a tall imperious silhouette reads at the
 *  boss origin, distinct from the gatekeeper's halo and the songstress's plumes (static).
 *  Drawn white; the encounter's tint colours it. */
const sovereignBody: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const R = size * 0.42;
    // A wide veil/cloak sweeping behind the shoulders (a broad arc).
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.moveTo(c - R * 0.2, c - R * 0.2);
    ctx.quadraticCurveTo(c - R * 1.25, c + R * 0.2, c - R * 0.85, c + R);
    ctx.lineTo(c + R * 0.85, c + R);
    ctx.quadraticCurveTo(c + R * 1.25, c + R * 0.2, c + R * 0.2, c - R * 0.2);
    ctx.closePath();
    ctx.fill();
    // Gown: a narrow waist flaring to a wide hem.
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.moveTo(c - R * 0.16, c - R * 0.3);
    ctx.quadraticCurveTo(c - R * 0.6, c + R, c - R * 0.5, c + R);
    ctx.lineTo(c + R * 0.5, c + R);
    ctx.quadraticCurveTo(c + R * 0.6, c + R, c + R * 0.16, c - R * 0.3);
    ctx.closePath();
    ctx.fill();
    // Head.
    ctx.beginPath();
    ctx.arc(c, c - R * 0.5, R * 0.24, 0, Math.PI * 2);
    ctx.fill();
    // A three-point star crown above the head.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const dx of [-1, 0, 1]) {
      const h = dx === 0 ? R * 0.34 : R * 0.24;
      const px = c + dx * R * 0.24;
      ctx.beginPath();
      ctx.moveTo(px, c - R * 0.72);
      ctx.lineTo(px - R * 0.08, c - R * 0.72 - h * 0.55);
      ctx.lineTo(px, c - R * 0.72 - h);
      ctx.lineTo(px + R * 0.08, c - R * 0.72 - h * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  },
};

/** A shared midboss familiar: a crystalline core with two small wings — a lesser foe than
 *  the stage bosses, reused across stages with a different per-encounter tint (the white +
 *  tint idiom in action). Static. */
const midbossBody: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const R = size * 0.34;
    // Two small wings.
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(c + s * R * 0.85, c, R * 0.6, R * 0.32, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Crystalline core: a tall diamond.
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(c, c - R);
    ctx.lineTo(c + R * 0.55, c);
    ctx.lineTo(c, c + R);
    ctx.lineTo(c - R * 0.55, c);
    ctx.closePath();
    ctx.fill();
    // Inner facet.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.moveTo(c, c - R * 0.5);
    ctx.lineTo(c + R * 0.28, c);
    ctx.lineTo(c, c + R * 0.5);
    ctx.lineTo(c - R * 0.28, c);
    ctx.closePath();
    ctx.fill();
  },
};

/** The Extra boss's body: a red-spider-lily bloom — a bright core ringed by six long,
 *  outward-curling stamens (the signature filaments of the higanbana). Its silhouette reads
 *  distinct from the finals' brim / crest / veil. Static; drawn white so its crimson
 *  `BossVisual.color` tints it. */
const shorekeeperBody: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const R = size * 0.36;
    // Six curling stamens radiating out (the spider-lily filaments), each a curved stroke
    // with a small anther dot at the tip.
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = size * 0.02;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const ex = c + Math.cos(a) * R;
      const ey = c + Math.sin(a) * R;
      const mx = c + Math.cos(a + 0.5) * R * 0.6;
      const my = c + Math.sin(a + 0.5) * R * 0.6;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(ex, ey, size * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bright core bloom.
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(c, c, R * 0.42, 0, Math.PI * 2);
    ctx.fill();
    // Inner petal ring.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(a) * R * 0.28, c + Math.sin(a) * R * 0.28, R * 0.16, R * 0.07, a, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** A custom full-colour player shot: an ofuda talisman — a crimson card with a white
 *  border and a gold sigil, drawn pointing +x so the renderer rotates it to point along
 *  travel (straight up). Unlike the glow `Shape` shots (a white mask tinted by the shot
 *  colour), this carries its OWN colours: fire it with a white tint to see the art untinted. */
const shotAmulet: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const w = size * 0.34; // half-length along +x (travel), h = across
    const h = size * 0.2;
    ctx.save();
    ctx.translate(c, c);
    // White border card.
    ctx.fillStyle = "rgba(250,250,255,1)";
    ctx.fillRect(-w, -h, w * 2, h * 2);
    // Crimson face inset.
    ctx.fillStyle = "rgba(210,40,55,1)";
    ctx.fillRect(-w * 0.78, -h * 0.66, w * 1.56, h * 1.32);
    // Gold sigil: a short bar down the card's spine + a dot.
    ctx.fillStyle = "rgba(245,205,90,1)";
    ctx.fillRect(-w * 0.5, -h * 0.14, w, h * 0.28);
    ctx.beginPath();
    ctx.arc(w * 0.5, 0, h * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};

/** An enemy danmaku bullet drawn as a solid talisman card rather than a glow blob — the
 *  reference custom-IMAGE bullet. Indigo face, gold border + sigil; authored pointing +x so
 *  it rotates to lie along travel. Deliberately sharp-edged and multi-colour so it reads as
 *  a distinct sprite over the additive glow haze (the Touhou fuda look). */
const talismanBullet: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    const w = size * 0.42; // half-length along +x (travel)
    const h = size * 0.26; // half-width across
    ctx.save();
    ctx.translate(c, c);
    // Gold border card.
    ctx.fillStyle = "rgba(240,200,95,1)";
    ctx.fillRect(-w, -h, w * 2, h * 2);
    // Indigo face inset.
    ctx.fillStyle = "rgba(60,45,150,1)";
    ctx.fillRect(-w * 0.8, -h * 0.68, w * 1.6, h * 1.36);
    // Pale sigil: a spine bar + a nub near the leading edge.
    ctx.fillStyle = "rgba(230,235,255,1)";
    ctx.fillRect(-w * 0.55, -h * 0.16, w * 1.1, h * 0.32);
    ctx.beginPath();
    ctx.arc(w * 0.55, 0, h * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
  shotAmulet: { source: shotAmulet }, // a full-colour custom-image player shot
  talismanBullet: { source: talismanBullet }, // a full-colour custom-image enemy bullet

  // Boss bodies — drawn at the boss origin while an encounter runs (passed to
  // `ctx.boss(script, { sprite, color, radius })`). Like the enemies, drawn white so the
  // per-encounter tint colours them; the shared `midbossBody` is reused across stages with
  // a different tint each time.
  gatekeeperBody: { source: gatekeeperBody }, // stage-1 final boss
  songstressBody: { source: songstressBody }, // stage-2 final boss
  sovereignBody: { source: sovereignBody }, // stage-3 final boss
  shorekeeperBody: { source: shorekeeperBody }, // Extra-stage boss
  midbossBody: { source: midbossBody }, // all three midbosses + the Extra midboss (tinted per stage)
});
