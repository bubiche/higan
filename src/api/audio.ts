// Audio authoring types — the slot model a game declares its sound with.
//
// This is the author-facing audio surface (re-exported from the `higan` barrel). The
// engine that consumes it lives in `src/audio`; the split mirrors the shot/bomb config
// pattern (types an author writes, an engine that reads them).
//
// The guiding idea: a `SoundSource` is a LOADER SLOT, not a sound. Today it holds a
// procedural synth stand-in; later it holds a real file — swapping one for the other is
// a one-line manifest edit (`kind: "synth"` → `kind: "url"`) with zero other change,
// because the engine resolves either into the same `AudioBuffer`. The SFX/BGM split
// (engine ships default SFX + the synth toolkit; a game composes its own BGM tracks) has
// an OTHER axis, handled by `defineBgm` below: engine-fixed vocabularies (`SfxId`) stay an
// enum, game-open ones (BGM, like sprites) are typed handles, not strings.

import type { SfxId } from "../core/events";
import type { SpriteManifest } from "./sprites";

/**
 * A procedural sound, offline-rendered once into a cached buffer.
 *
 * `durationSec` (and the optional loop window) are declared UP FRONT so the engine can
 * size the `OfflineAudioContext` before handing it to `render` — an `OfflineAudioContext`
 * fixes its length at construction, so the duration cannot be discovered from inside the
 * render pass. `render` then schedules the voices onto that context; the engine renders
 * it to a buffer. Loop points are in SECONDS (they map straight to
 * `AudioBufferSourceNode.loopStart/loopEnd`), so they stay correct regardless of the
 * sample rate the buffer is rendered at.
 *
 * Presentation-only: this runs entirely outside the sim (no determinism constraint —
 * use plain `Math.random`/`Math` freely here). The engine's synth toolkit (`bgmLoop`,
 * imported from `higan`) builds these for you; you rarely hand-write one.
 */
export interface SynthGen {
  /** Total rendered length in seconds (sizes the offline context). */
  readonly durationSec: number;
  /** BGM loop-window start, in seconds. Defaults to 0 (loop the whole buffer). Ignored
   *  for one-shot SFX. */
  readonly loopStart?: number;
  /** BGM loop-window end, in seconds. Defaults to `durationSec`. Ignored for SFX. */
  readonly loopEnd?: number;
  /** Schedule the sound onto an offline context whose length already equals
   *  `durationSec`. Called once at preload; the result is cached. */
  render(ctx: OfflineAudioContext): void;
}

/**
 * A loader slot for one sound. `synth` is a procedural stand-in (now); `url` is a real
 * audio file fetched + decoded (later). Both resolve to the same `AudioBuffer`, so a
 * game swaps a placeholder for a real file by changing only this union member.
 */
export type SoundSource =
  | { readonly kind: "synth"; readonly gen: SynthGen }
  | {
      readonly kind: "url";
      readonly src: string;
      /** BGM loop-window start in seconds (default 0). Ignored for one-shot SFX. */
      readonly loopStart?: number;
      /** BGM loop-window end in seconds (default = buffer duration). Ignored for SFX. */
      readonly loopEnd?: number;
    };

/** One named BGM track, as authored (before `defineBgm` stamps it into a handle). */
export interface BgmDef {
  readonly title: string;
  readonly source: SoundSource;
}

/**
 * A typed reference to one declared BGM track. Opaque to the author — you get these from
 * `defineBgm` and reference them inline (`StageDef.music`, `AudioManifest.shell`); a typo
 * is a COMPILE error, not silence. `id` is the stable key it was declared under (used
 * internally by the audio engine's buffer cache and the Music room's unlock list — both
 * keyed by string so a save file survives across sessions); `title` is the Music room's
 * display name.
 */
export interface BgmHandle {
  readonly id: string;
  readonly title: string;
  readonly source: SoundSource;
}

/**
 * Name a game's BGM once and get back typed handles to reference inline.
 *
 *   const bgm = defineBgm({
 *     title:  { title: "Prologue", source: { kind: "synth", gen: titleLoop } },
 *     stage1: { title: "Approach", source: { kind: "synth", gen: stageLoop } },
 *   });
 *   // referenced inline — a typo is a COMPILE error, not silence:
 *   stages: [{ id: "s1", script, music: { stage: bgm.stage1 } }]
 *
 * Hand the whole returned map to `assets.audio.bgm` so the engine preloads every track.
 * Mirrors `defineSprites` exactly: the key becomes the handle's stable `id`, so the
 * author never writes it twice.
 */
export function defineBgm<K extends string>(defs: Record<K, BgmDef>): Record<K, BgmHandle> {
  const out = {} as Record<K, BgmHandle>;
  for (const id in defs) {
    out[id] = { id, ...defs[id] };
  }
  return out;
}

/**
 * A game's declared audio. BGM is a library of author-named tracks, referenced by TYPED
 * HANDLE (from `defineBgm`) — the same handle idiom `defineSprites` uses for game art, for
 * the same reason (a typo is a compile error, not a silent blank). SFX is an OPTIONAL
 * override map keyed by the engine's `SfxId` — any id a game omits uses the engine's
 * default sound, so a game that authors no `sfx` still has a full soundscape. SFX stays an
 * enum rather than a handle because it's an engine-FIXED vocabulary (like bullet `Shape`),
 * not a game-open library. `shell` names the BGM for the non-stage screens.
 */
export interface AudioManifest {
  /** BGM library: the whole `defineBgm(...)` result. Referenced by `StageDef.music` and
   *  `shell`. */
  readonly bgm: Record<string, BgmHandle>;
  /** Per-`SfxId` sound overrides; omitted ids fall back to the engine default. */
  readonly sfx?: Partial<Record<SfxId, SoundSource>>;
  /** BGM handles for the shell screens (title/menu screens, results). */
  readonly shell?: { readonly title?: BgmHandle; readonly results?: BgmHandle };
}

/**
 * The game's asset bag — one slot per asset kind, each optional so a minimal game declares
 * only what it uses. Audio and sprites are wired; cut-ins/portraits ride the sprite slot's
 * `ImageSource` (DOM-resolved). Every slot is presentation — the headless/determinism paths
 * never touch it.
 */
export interface AssetManifest {
  readonly audio?: AudioManifest;
  /** Sprites (enemies/boss/player/items/portraits) + optional per-type item overrides. */
  readonly sprites?: SpriteManifest;
}
