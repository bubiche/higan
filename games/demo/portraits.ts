// The reference game's cut-in portraits — placeholder procedural busts.
//
// Portraits are the DOM-resolved half of the sprite vocabulary: the SAME `defineSprites`
// handles + `ImageSource` loader-slot as everything else (swap `procedural → url` for real
// art with no other change), but shown as large DOM images in the cut-in overlay rather than
// atlased into the GL sprite pass. So this is a SEPARATE `defineSprites` block, deliberately
// NOT handed to `assets.sprites.library` — routing follows the reference site (a portrait is
// referenced from `stage.bossInfo` / `character.portrait`), exactly as background handles are
// referenced from `stage.background` and never atlased.
//
// Each drawer paints a bust anchored to the BOTTOM of its square canvas, because the cut-in
// shows the portrait bottom-aligned rising from the field edge.

import { defineSprites, type ImageSource } from "higan";

/** The boss: a cool-toned figure with a wide hat — the "Azure Gatekeeper". */
const gatekeeper: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    // Robe/torso (rises from the bottom edge).
    ctx.fillStyle = "rgba(52,72,140,0.96)";
    ctx.beginPath();
    ctx.moveTo(c - size * 0.32, size);
    ctx.quadraticCurveTo(c - size * 0.36, size * 0.6, c - size * 0.15, size * 0.5);
    ctx.lineTo(c + size * 0.15, size * 0.5);
    ctx.quadraticCurveTo(c + size * 0.36, size * 0.6, c + size * 0.32, size);
    ctx.closePath();
    ctx.fill();
    // Collar accent.
    ctx.fillStyle = "rgba(120,150,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(c, size * 0.5);
    ctx.lineTo(c - size * 0.17, size * 0.66);
    ctx.lineTo(c + size * 0.17, size * 0.66);
    ctx.closePath();
    ctx.fill();
    // Face.
    ctx.fillStyle = "rgba(244,232,222,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
    // Hair (frames the face, cool tone).
    ctx.fillStyle = "rgba(66,104,206,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.15, Math.PI * 0.85, Math.PI * 2.15);
    ctx.fill();
    // Wide hat brim.
    ctx.fillStyle = "rgba(40,58,120,0.98)";
    ctx.beginPath();
    ctx.ellipse(c, size * 0.29, size * 0.26, size * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c, size * 0.24, size * 0.12, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    // Glowing eyes.
    ctx.fillStyle = "rgba(130,225,255,1)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c + s * size * 0.05, size * 0.41, size * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** The playable heroine: a smaller, warm-toned figure. */
const heroine: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    // Dress/torso.
    ctx.fillStyle = "rgba(180,64,90,0.96)";
    ctx.beginPath();
    ctx.moveTo(c - size * 0.26, size);
    ctx.quadraticCurveTo(c - size * 0.3, size * 0.66, c - size * 0.12, size * 0.56);
    ctx.lineTo(c + size * 0.12, size * 0.56);
    ctx.quadraticCurveTo(c + size * 0.3, size * 0.66, c + size * 0.26, size);
    ctx.closePath();
    ctx.fill();
    // Collar/bow accent.
    ctx.fillStyle = "rgba(255,220,140,0.95)";
    ctx.beginPath();
    ctx.arc(c, size * 0.58, size * 0.045, 0, Math.PI * 2);
    ctx.fill();
    // Face.
    ctx.fillStyle = "rgba(248,236,226,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.46, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    // Hair (warm, longer).
    ctx.fillStyle = "rgba(210,120,60,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.45, size * 0.15, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c - size * 0.13, size * 0.56, size * 0.05, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c + size * 0.13, size * 0.56, size * 0.05, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eyes.
    ctx.fillStyle = "rgba(90,140,220,1)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c + s * size * 0.045, size * 0.47, size * 0.018, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** Stage 2's boss: a warm-toned figure with long flowing hair and a small flame crest —
 *  the "Ember Songstress". No wide hat, so her silhouette reads distinct from the Gatekeeper. */
const songstress: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    // Gown/torso (rises from the bottom edge), warm crimson-orange.
    ctx.fillStyle = "rgba(176,58,44,0.96)";
    ctx.beginPath();
    ctx.moveTo(c - size * 0.3, size);
    ctx.quadraticCurveTo(c - size * 0.34, size * 0.6, c - size * 0.14, size * 0.5);
    ctx.lineTo(c + size * 0.14, size * 0.5);
    ctx.quadraticCurveTo(c + size * 0.34, size * 0.6, c + size * 0.3, size);
    ctx.closePath();
    ctx.fill();
    // Sash accent (gold).
    ctx.fillStyle = "rgba(255,206,120,0.95)";
    ctx.beginPath();
    ctx.moveTo(c, size * 0.5);
    ctx.lineTo(c - size * 0.15, size * 0.72);
    ctx.lineTo(c + size * 0.15, size * 0.72);
    ctx.closePath();
    ctx.fill();
    // Long flowing hair behind the face (warm amber), draping past the shoulders.
    ctx.fillStyle = "rgba(224,140,66,0.98)";
    ctx.beginPath();
    ctx.ellipse(c - size * 0.16, size * 0.56, size * 0.06, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c + size * 0.16, size * 0.56, size * 0.06, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.17, Math.PI * 0.75, Math.PI * 2.25);
    ctx.fill();
    // Face.
    ctx.fillStyle = "rgba(250,236,224,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
    // Flame crest above the head (a small three-tongue flame instead of a hat).
    ctx.fillStyle = "rgba(255,150,60,0.98)";
    for (const [dx, h] of [[-0.06, 0.1], [0, 0.14], [0.06, 0.1]] as const) {
      ctx.beginPath();
      ctx.moveTo(c + dx * size, size * 0.26);
      ctx.quadraticCurveTo(c + dx * size + size * 0.03, size * (0.26 - h * 0.6), c + dx * size, size * (0.26 - h));
      ctx.quadraticCurveTo(c + dx * size - size * 0.03, size * (0.26 - h * 0.6), c + dx * size, size * 0.26);
      ctx.fill();
    }
    // Glowing warm eyes.
    ctx.fillStyle = "rgba(255,210,120,1)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c + s * size * 0.05, size * 0.41, size * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** Stage 3's boss: the Nocturne Sovereign — a cool indigo/silver figure with a swept veil
 *  and a small three-point star crown instead of a hat, so her silhouette reads distinct from
 *  the Gatekeeper's brim and the Songstress's flame crest. The regal finale look. */
const nocturne: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    // Gown/torso (rises from the bottom edge), deep indigo.
    ctx.fillStyle = "rgba(70,64,150,0.96)";
    ctx.beginPath();
    ctx.moveTo(c - size * 0.32, size);
    ctx.quadraticCurveTo(c - size * 0.36, size * 0.58, c - size * 0.14, size * 0.5);
    ctx.lineTo(c + size * 0.14, size * 0.5);
    ctx.quadraticCurveTo(c + size * 0.36, size * 0.58, c + size * 0.32, size);
    ctx.closePath();
    ctx.fill();
    // A pale veil sweeping behind the shoulders (silver, low alpha).
    ctx.fillStyle = "rgba(190,200,240,0.6)";
    ctx.beginPath();
    ctx.moveTo(c, size * 0.52);
    ctx.quadraticCurveTo(c - size * 0.42, size * 0.66, c - size * 0.34, size);
    ctx.lineTo(c - size * 0.2, size);
    ctx.quadraticCurveTo(c - size * 0.16, size * 0.66, c, size * 0.56);
    ctx.quadraticCurveTo(c + size * 0.16, size * 0.66, c + size * 0.2, size);
    ctx.lineTo(c + size * 0.34, size);
    ctx.quadraticCurveTo(c + size * 0.42, size * 0.66, c, size * 0.52);
    ctx.closePath();
    ctx.fill();
    // Sash accent (starlit cyan).
    ctx.fillStyle = "rgba(150,220,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(c, size * 0.5);
    ctx.lineTo(c - size * 0.14, size * 0.7);
    ctx.lineTo(c + size * 0.14, size * 0.7);
    ctx.closePath();
    ctx.fill();
    // Long hair framing the face (cool silver-violet).
    ctx.fillStyle = "rgba(150,150,210,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.16, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c - size * 0.15, size * 0.55, size * 0.05, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(c + size * 0.15, size * 0.55, size * 0.05, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Face.
    ctx.fillStyle = "rgba(240,238,250,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
    // Three-point star crown above the head.
    ctx.fillStyle = "rgba(210,225,255,0.98)";
    for (const [dx, h] of [[-0.07, 0.09], [0, 0.13], [0.07, 0.09]] as const) {
      const px = c + dx * size;
      ctx.beginPath();
      ctx.moveTo(px, size * 0.26);
      ctx.lineTo(px - size * 0.025, size * (0.26 - h * 0.5));
      ctx.lineTo(px, size * (0.26 - h));
      ctx.lineTo(px + size * 0.025, size * (0.26 - h * 0.5));
      ctx.closePath();
      ctx.fill();
    }
    // Glowing cool eyes.
    ctx.fillStyle = "rgba(150,225,255,1)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c + s * size * 0.05, size * 0.41, size * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** The Extra boss: the Crimson Shorekeeper — warden of the far shore. A crimson-robed figure
 *  crowned with the curling stamens of a red spider lily, so her silhouette reads distinct from
 *  the campaign bosses' brim / crest / star-crown. The deepest, most saturated portrait — the
 *  post-campaign challenge. */
const shorekeeper: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    const c = size / 2;
    // Robe/torso (rises from the bottom edge), deep crimson.
    ctx.fillStyle = "rgba(150,20,40,0.96)";
    ctx.beginPath();
    ctx.moveTo(c - size * 0.32, size);
    ctx.quadraticCurveTo(c - size * 0.38, size * 0.56, c - size * 0.14, size * 0.5);
    ctx.lineTo(c + size * 0.14, size * 0.5);
    ctx.quadraticCurveTo(c + size * 0.38, size * 0.56, c + size * 0.32, size);
    ctx.closePath();
    ctx.fill();
    // A dark trailing shawl behind the shoulders (low alpha).
    ctx.fillStyle = "rgba(90,10,30,0.7)";
    ctx.beginPath();
    ctx.moveTo(c, size * 0.52);
    ctx.quadraticCurveTo(c - size * 0.44, size * 0.68, c - size * 0.36, size);
    ctx.lineTo(c - size * 0.2, size);
    ctx.quadraticCurveTo(c - size * 0.16, size * 0.68, c, size * 0.56);
    ctx.quadraticCurveTo(c + size * 0.16, size * 0.68, c + size * 0.2, size);
    ctx.lineTo(c + size * 0.36, size);
    ctx.quadraticCurveTo(c + size * 0.44, size * 0.68, c, size * 0.52);
    ctx.closePath();
    ctx.fill();
    // Sash accent (bright scarlet).
    ctx.fillStyle = "rgba(255,80,70,0.9)";
    ctx.beginPath();
    ctx.moveTo(c, size * 0.5);
    ctx.lineTo(c - size * 0.13, size * 0.7);
    ctx.lineTo(c + size * 0.13, size * 0.7);
    ctx.closePath();
    ctx.fill();
    // Long hair framing the face (dark wine).
    ctx.fillStyle = "rgba(120,30,55,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.16, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(c + s * size * 0.15, size * 0.55, size * 0.05, size * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Face.
    ctx.fillStyle = "rgba(250,238,236,0.98)";
    ctx.beginPath();
    ctx.arc(c, size * 0.4, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
    // A spider-lily crown: curling stamens fanning up from behind the head.
    ctx.strokeStyle = "rgba(255,60,60,0.95)";
    ctx.lineWidth = size * 0.012;
    for (const dx of [-0.11, -0.06, 0, 0.06, 0.11]) {
      const bx = c + dx * size;
      ctx.beginPath();
      ctx.moveTo(bx, size * 0.27);
      ctx.quadraticCurveTo(bx + dx * size * 1.2, size * 0.13, bx + dx * size * 1.9, size * 0.16);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,120,110,0.95)";
      ctx.beginPath();
      ctx.arc(bx + dx * size * 1.9, size * 0.16, size * 0.014, 0, Math.PI * 2);
      ctx.fill();
    }
    // Glowing crimson eyes.
    ctx.fillStyle = "rgba(255,70,70,1)";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c + s * size * 0.05, size * 0.41, size * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/**
 * The game's cut-in portraits. Referenced from `stage.bossInfo.portrait` and
 * `character.portrait` — NOT from `assets.sprites.library`, so they resolve to DOM images
 * (never atlased). Swap any `source` to `{ kind: "url", src }` for real art with no other change.
 */
export const demoPortraits = defineSprites({
  gatekeeper: { source: gatekeeper },
  songstress: { source: songstress },
  nocturne: { source: nocturne },
  shorekeeper: { source: shorekeeper },
  heroine: { source: heroine },
});
