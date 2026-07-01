// Sound loading — resolve a SoundSource loader slot into a decoded AudioBuffer.
//
// This is where the `synth | url` union collapses into one concrete buffer, so the rest
// of the engine never branches on source kind again:
//   - synth: offline-render the generator into a buffer (once, at preload).
//   - url:   fetch + decodeAudioData a real file.
// Rendering uses the LIVE context's sample rate, so playback never resamples and the
// loop points (kept in seconds) stay sample-accurate.
//
// Defensive by contract (like save.ts): a load failure NEVER throws — it logs and
// returns null, and the engine simply no-ops that sound. A missing file must not break
// the game.

import type { SoundSource } from "../api/audio";

/** A resolved sound: its buffer plus the loop window (seconds) for BGM playback. SFX
 *  ignore the loop fields. */
export interface LoadedSound {
  readonly buffer: AudioBuffer;
  readonly loopStart: number;
  readonly loopEnd: number;
}

/**
 * Resolve one source into a buffer. `audioCtx` is the live context — used for its sample
 * rate (offline render matches it, so no resample) and for `decodeAudioData` on the url
 * path. Returns null on any failure (logged, never thrown).
 */
export async function resolveSource(
  source: SoundSource,
  audioCtx: BaseAudioContext,
): Promise<LoadedSound | null> {
  try {
    if (source.kind === "synth") {
      const { gen } = source;
      const sampleRate = audioCtx.sampleRate;
      const length = Math.max(1, Math.ceil(gen.durationSec * sampleRate));
      const octx = new OfflineAudioContext(2, length, sampleRate);
      gen.render(octx);
      const buffer = await octx.startRendering();
      return { buffer, loopStart: gen.loopStart ?? 0, loopEnd: gen.loopEnd ?? buffer.duration };
    }
    const resp = await fetch(source.src);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${source.src}`);
    const buffer = await audioCtx.decodeAudioData(await resp.arrayBuffer());
    return { buffer, loopStart: source.loopStart ?? 0, loopEnd: source.loopEnd ?? buffer.duration };
  } catch (err) {
    console.warn("[higan audio] failed to load sound:", err);
    return null;
  }
}
