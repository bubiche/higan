// Alpha sprite pass — the representational-art layer (enemies, items, the player craft).
//
// This is the SECOND render pass, distinct from the additive-glow bullet/laser pass:
//   - It reuses the bullet program's exact quad transform (`INSTANCED_QUAD_VS`) and the
//     same interleaved instance format (x, y, scale, angle, r, g, b, layer), so an enemy
//     is packed identically to a bullet — but it draws with its OWN fragment shader and
//     STRAIGHT-ALPHA "over" blend instead of premultiplied-additive glow.
//   - Its fragment shader samples the texture's RGB (not alpha-only): real art shows its
//     own colours, while a placeholder drawn white is coloured by the per-instance tint —
//     so the existing amber/teal/rose enemy colour-coding survives the move to sprites.
//   - Its texture is a `TEXTURE_2D_ARRAY` built asynchronously from the game's
//     `SpriteManifest`: engine default sprites (a fallback enemy, the player, one per item
//     type) + the game's `library` handles + any per-type item overrides. A sprite with
//     `frames > 1` occupies that many CONSECUTIVE layers, cycled by a presentation clock.
//
// Determinism: nothing here is sim state. Handles carry a render-only atlas layer stamped
// at load; animation is driven by a wall/frame clock, never the sim tick. Import-safe in a
// headless (no-GL/DOM) context — all `document`/GL calls are inside `load`/`createSpriteRenderer`,
// never at module load — so the determinism harness can import a game that declares sprites.

import { createProgram } from "./gl";
import { INSTANCED_QUAD_VS, INSTANCE_FLOATS } from "./bullets";
import { ItemType } from "../touhou/item";
import type { SpriteManifest, ImageSource, SpriteDef, SpriteHandle } from "../api/sprites";

/** Atlas cell resolution. Larger than the 64px glow atlas — representational art (real
 *  sprites later) wants the detail; the glow bullets never did. */
const SPRITE_SIZE = 128;

const FS = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;   // 3.00 has no default precision for array samplers
in vec2 vUV;
in vec3 vColor;
flat in float vLayer;
uniform sampler2DArray uTex;
out vec4 frag;
void main() {
  vec4 t = texture(uTex, vec3(vUV, vLayer));
  // Straight alpha: the tint MULTIPLIES the sprite's own colour (white placeholder → tinted
  // silhouette; real art × white tint → itself). Drawn with SRC_ALPHA/ONE_MINUS_SRC_ALPHA.
  frag = vec4(t.rgb * vColor, t.a);
}`;

// ── Engine default sprites (white shapes; tinted per instance) ─────────────────────
// Shipped so a minimal game with no sprite manifest still renders — the visual twin of the
// engine's default SFX. Drawn white; the item tint (ITEM_VISUAL) and the enemy/player tint
// colour them. `frame`/`frames` are ignored (all engine defaults are single-frame).

function centre(size: number): number {
  return size / 2;
}

/** A generic foe: a rounded diamond core with a soft outline. */
const defaultEnemyDraw = (ctx: CanvasRenderingContext2D, size: number): void => {
  const c = centre(size);
  const R = size * 0.34;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(c, c - R);
  ctx.lineTo(c + R, c);
  ctx.lineTo(c, c + R);
  ctx.lineTo(c - R, c);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(c, c, R * 0.4, 0, Math.PI * 2);
  ctx.fill();
};

/** The player craft: an upward arrowhead. */
const defaultPlayerDraw = (ctx: CanvasRenderingContext2D, size: number): void => {
  const c = centre(size);
  const R = size * 0.34;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(c, c - R);
  ctx.lineTo(c + R * 0.8, c + R * 0.8);
  ctx.lineTo(c, c + R * 0.35);
  ctx.lineTo(c - R * 0.8, c + R * 0.8);
  ctx.closePath();
  ctx.fill();
};

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Default item icons, per type — distinct white silhouettes, tinted by ITEM_VISUAL. */
const defaultItemDraw: Record<ItemType, (ctx: CanvasRenderingContext2D, size: number) => void> = {
  [ItemType.Power]: (ctx, size) => {
    const c = centre(size);
    const R = size * 0.32;
    ctx.fillStyle = "rgba(255,255,255,0.95)"; // a five-pointed gem
    star(ctx, c, c, 5, R, R * 0.55);
  },
  [ItemType.Point]: (ctx, size) => {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    star(ctx, centre(size), centre(size), 4, size * 0.36, size * 0.14);
  },
  [ItemType.Life]: (ctx, size) => {
    const c = centre(size);
    const R = size * 0.3;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(c, c + R);
    ctx.bezierCurveTo(c - R * 1.4, c - R * 0.2, c - R * 0.5, c - R * 1.2, c, c - R * 0.4);
    ctx.bezierCurveTo(c + R * 0.5, c - R * 1.2, c + R * 1.4, c - R * 0.2, c, c + R);
    ctx.fill();
  },
  [ItemType.Bomb]: (ctx, size) => {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    star(ctx, centre(size), centre(size), 6, size * 0.34, size * 0.16);
  },
  [ItemType.FullPower]: (ctx, size) => {
    const c = centre(size);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = size * 0.09;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(c, c, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
  },
};

// ── Image resolution (the loader-slot union → drawable frames) ─────────────────────

/** Load one image url into an HTMLImageElement (defensive: resolves null on any failure —
 *  a missing sprite must not break the game, mirroring the audio loader). */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("[higan sprites] failed to load image:", src);
      resolve(null);
    };
    img.src = src;
  });
}

/** One sprite to place in the atlas: a source, its frame count, and (for url) the loaded
 *  image. Painted frame-by-frame into consecutive layers. */
interface Placed {
  readonly source: ImageSource;
  readonly frames: number;
  readonly fps: number;
  /** The resolved url image (null until loaded / on failure); unused for procedural. */
  img: HTMLImageElement | null;
  /** Base atlas layer, assigned during layout. */
  base: number;
}

function placedFromDef(def: SpriteDef): Placed {
  return { source: def.source, frames: Math.max(1, def.frames ?? 1), fps: def.fps ?? 0, img: null, base: -1 };
}

/** Paint one frame of a placed sprite into a `size × size` canvas context (cleared first). */
function paintFrame(ctx: CanvasRenderingContext2D, size: number, p: Placed, frame: number): void {
  ctx.clearRect(0, 0, size, size);
  if (p.source.kind === "procedural") {
    p.source.draw(ctx, size, frame, p.frames);
    return;
  }
  const img = p.img;
  if (!img) return; // failed/absent url → an empty (transparent) cell
  // A url sheet is a horizontal strip of `frames` square cells; draw the frame's cell
  // scaled to fill the atlas cell.
  const cellW = img.width / p.frames;
  ctx.drawImage(img, frame * cellW, 0, cellW, img.height, 0, 0, size, size);
}

// ── Layout + animation (pure — no GL/DOM, so headless-testable) ────────────────────

const ITEM_TYPES: readonly ItemType[] = [
  ItemType.Power,
  ItemType.Point,
  ItemType.Life,
  ItemType.Bomb,
  ItemType.FullPower,
];

/** The atlas plan: every sprite's base layer + the index maps the renderer resolves against.
 *  Computed without touching GL — `load` turns it into an uploaded texture. */
export interface SpriteLayout {
  /** Every sprite to upload, in layer order, each with its assigned `base`. */
  readonly placements: readonly Placed[];
  readonly totalLayers: number;
  readonly defaultEnemyLayer: number;
  readonly defaultPlayerLayer: number;
  readonly itemLayer: Record<ItemType, number>;
  /** Animated base layers → their frame count + fps (static sprites are absent). */
  readonly anim: Map<number, { frames: number; fps: number }>;
}

/**
 * Assign atlas layers to the engine defaults + the game's library + item overrides, in a
 * STABLE order (defaults, then library in source order, then overrides) so a hot-reload keeps
 * each sprite id on the same layer. Stamps `handle.layer` on every library handle. Pure of GL
 * — the same layout is testable headlessly and turned into a texture by `load`.
 */
export function planSpriteLayout(manifest: SpriteManifest | undefined): SpriteLayout {
  const enemy = placedFromDef({ source: { kind: "procedural", draw: defaultEnemyDraw } });
  const player = placedFromDef({ source: { kind: "procedural", draw: defaultPlayerDraw } });
  const defaultItems = {} as Record<ItemType, Placed>;
  const placements: Placed[] = [enemy, player];
  for (const t of ITEM_TYPES) {
    const p = placedFromDef({ source: { kind: "procedural", draw: defaultItemDraw[t] } });
    defaultItems[t] = p;
    placements.push(p);
  }

  const libEntries: Array<{ handle: SpriteHandle; placed: Placed }> = [];
  if (manifest) {
    for (const id in manifest.library) {
      const handle = manifest.library[id]!;
      const placed = placedFromDef(handle.def);
      libEntries.push({ handle, placed });
      placements.push(placed);
    }
  }

  const overrideItems: Array<{ type: ItemType; placed: Placed }> = [];
  if (manifest?.items) {
    for (const t of ITEM_TYPES) {
      const def = manifest.items[t];
      if (def) {
        const placed = placedFromDef(def);
        overrideItems.push({ type: t, placed });
        placements.push(placed);
      }
    }
  }

  // Assign base layers sequentially — the layout is known from declared frame counts, no
  // image load needed to size the atlas.
  let layer = 0;
  for (const p of placements) {
    p.base = layer;
    layer += p.frames;
  }

  const itemLayer = {} as Record<ItemType, number>;
  for (const t of ITEM_TYPES) itemLayer[t] = defaultItems[t]!.base;
  for (const e of overrideItems) itemLayer[e.type] = e.placed.base;

  const anim = new Map<number, { frames: number; fps: number }>();
  const registerAnim = (p: Placed): void => {
    if (p.frames > 1 && p.fps > 0) anim.set(p.base, { frames: p.frames, fps: p.fps });
  };
  for (const e of libEntries) {
    e.handle.layer = e.placed.base;
    registerAnim(e.placed);
  }
  // Item overrides animate too (their frames are already reserved above) — resolved at draw
  // by item type, not a handle, so they need no `.layer` stamp, only an `anim` entry.
  for (const e of overrideItems) registerAnim(e.placed);

  return {
    placements,
    totalLayers: Math.max(1, layer),
    defaultEnemyLayer: enemy.base,
    defaultPlayerLayer: player.base,
    itemLayer,
    anim,
  };
}

/** The animated atlas layer for a base layer at `clockSec`: a frame offset for an animated
 *  base (present in `anim`), else the base unchanged. `base < 0` passes through (the caller
 *  treats < 0 as "draw nothing"). Pure — the off-by-one-prone arithmetic, unit-testable. */
export function animatedLayer(
  anim: Map<number, { frames: number; fps: number }>,
  base: number,
  clockSec: number,
): number {
  if (base < 0) return -1;
  const a = anim.get(base);
  if (!a) return base;
  return base + (Math.floor(clockSec * a.fps) % a.frames);
}

// ── The renderer ───────────────────────────────────────────────────────────────

export interface SpriteRenderer {
  /** Draw `count` caller-marshalled instances (enemies, items, the player) with straight-
   *  alpha blend, sampling the sprite atlas. `data` holds `INSTANCE_FLOATS` per instance
   *  (x, y, scale, angle, r, g, b, layer). No-op until the atlas has loaded, or for count ≤ 0. */
  drawInstances(data: Float32Array, count: number): void;
  /** Resolve + upload the atlas from a manifest (engine defaults always included), stamping
   *  `handle.layer` on every library handle. Awaitable; call again to hot-reload after an
   *  edit (stable layer order keeps live entities' stored base layers valid). */
  load(manifest: SpriteManifest | undefined): Promise<void>;
  /** The animated atlas layer for a base layer at `clockSec` (a frame offset for an animated
   *  sprite, else the base). Returns -1 (draw nothing) if `base < 0` or the atlas is unloaded. */
  layerForBase(base: number, clockSec: number): number;
  /** Base layer of the default (fallback) enemy sprite, or -1 if unloaded. */
  readonly defaultEnemyLayer: number;
  /** Base layer of the default player craft sprite, or -1 if unloaded. */
  readonly defaultPlayerLayer: number;
  /** Base layer of an item type's sprite (a per-type override if the game gave one, else the
   *  engine default), or -1 if unloaded. */
  itemBaseLayer(type: ItemType): number;
  /** Whether the atlas has finished loading (drawing is a no-op before this). */
  readonly loaded: boolean;
}

export function createSpriteRenderer(
  gl: WebGL2RenderingContext,
  fieldW: number,
  fieldH: number,
  capacity: number,
): SpriteRenderer {
  const prog = createProgram(gl, INSTANCED_QUAD_VS, FS);
  const uViewport = gl.getUniformLocation(prog, "uViewport");
  const uTex = gl.getUniformLocation(prog, "uTex");

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const instData = new Float32Array(capacity * INSTANCE_FLOATS);
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
  const stride = INSTANCE_FLOATS * 4;
  gl.enableVertexAttribArray(1); // aPos
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); // aScale
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); // aAngle
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4); // aColor
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5); // aLayer
  gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 28);
  gl.vertexAttribDivisor(5, 1);
  gl.bindVertexArray(null);

  let tex: WebGLTexture | null = null;
  let loaded = false;
  let defaultEnemyLayer = -1;
  let defaultPlayerLayer = -1;
  const itemLayer: Record<ItemType, number> = {
    [ItemType.Power]: -1,
    [ItemType.Point]: -1,
    [ItemType.Life]: -1,
    [ItemType.Bomb]: -1,
    [ItemType.FullPower]: -1,
  };
  // Animated base layers → their frame count + fps (static sprites are absent → base as-is).
  // Reassigned wholesale on each (re)load from the pure layout plan.
  let anim = new Map<number, { frames: number; fps: number }>();

  async function load(manifest: SpriteManifest | undefined): Promise<void> {
    // Plan the layout (pure — assigns layers + stamps handles), then load url images and
    // upload. Keeping the layout GL-free lets it be asserted headlessly (verify-8a).
    const layout = planSpriteLayout(manifest);

    // Load every url image concurrently (procedural sprites need nothing).
    await Promise.all(
      layout.placements.map(async (p) => {
        if (p.source.kind === "url") p.img = await loadImage(p.source.src);
      }),
    );

    // Adopt the resolved indices (after the awaits, so a failed image doesn't half-update).
    defaultEnemyLayer = layout.defaultEnemyLayer;
    defaultPlayerLayer = layout.defaultPlayerLayer;
    for (const t of ITEM_TYPES) itemLayer[t] = layout.itemLayer[t];
    anim = layout.anim;

    // Upload. Rebuild the texture (a reload may change the layer count).
    const size = SPRITE_SIZE;
    const next = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, next);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, size, size, layout.totalLayers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    for (const p of layout.placements) {
      for (let f = 0; f < p.frames; f++) {
        paintFrame(ctx, size, p, f);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, p.base + f, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
      }
    }
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (tex) gl.deleteTexture(tex);
    tex = next;
    loaded = true;
  }

  return {
    load,
    get loaded(): boolean {
      return loaded;
    },
    get defaultEnemyLayer(): number {
      return defaultEnemyLayer;
    },
    get defaultPlayerLayer(): number {
      return defaultPlayerLayer;
    },
    itemBaseLayer(type): number {
      return itemLayer[type];
    },
    layerForBase(base, clockSec): number {
      return loaded ? animatedLayer(anim, base, clockSec) : -1;
    },
    drawInstances(data, count): void {
      if (!loaded || !tex || count <= 0) return;
      gl.useProgram(prog);
      gl.uniform2f(uViewport, fieldW, fieldH);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // straight-alpha "over"
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.uniform1i(uTex, 0);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INSTANCE_FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    },
  };
}
