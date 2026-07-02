// The audio engine — the presentation-side sound system.
//
// Created ONCE by `runGame` and shared via `shell.audio` (like the two renderers:
// content-agnostic, survives run restarts). Everything here is presentation — it reads
// the sim AFTER a step and never enters `sim.step` or the hash, so `AudioContext`
// wall-clock (`currentTime`) is fine (the sim-side wall-clock ban does not apply).
//
// Two buses, deliberately asymmetric:
//   - SFX: transient, event-driven. `play`/`playEvents` fire one-shot voices with stereo
//     pan, a per-id throttle, and a polyphony cap.
//   - BGM: a state, not an event. `playBgm(id)` is IDEMPOTENT and desired-track-driven:
//     a caller re-asserts the wanted track every frame and a no-op results unless it
//     actually changed — which is what lets a state read (`sim.boss ? boss : stage`)
//     drive music and follow scrub for free. Switching crossfades between two channels;
//     each track loops gaplessly via sample-accurate loop points.
//
// `Shell.audio` is non-optional; a silent game (no manifest) or a context-less browser
// gets `createNullAudioEngine()` — every method a safe no-op — so screens call
// `shell.audio.playBgm(...)` unconditionally with no null guards.

import type { AudioManifest, SoundSource } from "../api/audio";
import { SfxId, type SfxEvent } from "../core/events";
import { PLAYFIELD_W } from "../core/playfield";
import { DEFAULT_SFX } from "./synth";
import { resolveSource, type LoadedSound } from "./load";

/** Live master volumes (0..1), read fresh so `applyVolumes()` reflects the latest save. */
export interface AudioVolumes {
  readonly bgm: number;
  readonly sfx: number;
}

export interface AudioEngine {
  /** Resolve every SFX (override or engine default) and BGM track in the manifest into
   *  cached buffers. Async + non-throwing; a sound no-ops until its buffer lands. */
  preload(manifest: AudioManifest): void;
  /** Resume the AudioContext (call on the first user gesture — browsers suspend it
   *  until then). Re-asserts the desired BGM once running. */
  resume(): void;
  /** Play one SFX. No-op if the context isn't running, the buffer isn't loaded, or the
   *  per-id throttle window hasn't elapsed. `x` = playfield x for stereo pan (centre if
   *  omitted); `n` = batched count for a mild intensity bump (presentation-only). */
  play(id: SfxId, x?: number, n?: number): void;
  /** Play a batch of SFX events (the in-game screen passes `sim.events`). */
  playEvents(events: readonly SfxEvent[]): void;
  /** Switch BGM to `trackId` (idempotent — re-asserting the current track is a no-op);
   *  `null` fades to silence. Crossfades; the new track loops gaplessly. */
  playBgm(trackId: string | null): void;
  /** Re-read the master volumes and apply them (Options calls this after a change). */
  applyVolumes(): void;
}

/** The no-op engine for a silent game or a browser without Web Audio. Methods take no
 *  params (a narrower signature still satisfies the interface) so none read as unused. */
export function createNullAudioEngine(): AudioEngine {
  return {
    preload(): void {},
    resume(): void {},
    play(): void {},
    playEvents(): void {},
    playBgm(): void {},
    applyVolumes(): void {},
  };
}

/** Min seconds between two plays of the SAME SfxId — stops a per-tick sound (shoot) from
 *  buzzing when several land close together (fast-fire / catch-up). */
const SFX_THROTTLE = 0.04;
/** Concurrent SFX voice cap; over it, the oldest voice is stolen. */
const MAX_VOICES = 16;
/** BGM crossfade length in seconds. */
const BGM_FADE = 0.35;

/**
 * @param onTrackStart Fired with a track id the instant it ACTUALLY starts playing (inside
 *   `sync`, not on request) — the true "first heard" moment. The shell wires this to
 *   unlock-on-hear (Music room). Firing on request would be wrong: the title theme is
 *   requested before the first user gesture and only truly plays once the context resumes.
 */
export function createAudioEngine(
  audioCtx: AudioContext,
  volumes: () => AudioVolumes,
  onTrackStart?: (trackId: string) => void,
): AudioEngine {
  // ── Master graph ──────────────────────────────────────────────────────────────
  const sfxMaster = audioCtx.createGain();
  sfxMaster.connect(audioCtx.destination);
  const bgmMaster = audioCtx.createGain();
  bgmMaster.connect(audioCtx.destination);
  // Two BGM channels for crossfading; both start silent.
  const bgmA = audioCtx.createGain();
  const bgmB = audioCtx.createGain();
  bgmA.gain.value = 0;
  bgmB.gain.value = 0;
  bgmA.connect(bgmMaster);
  bgmB.connect(bgmMaster);

  const applyVolumes = (): void => {
    const v = volumes();
    bgmMaster.gain.value = v.bgm;
    sfxMaster.gain.value = v.sfx;
  };
  applyVolumes();

  // ── Caches (keyed by slot: an SfxId has one effective sound, a track one buffer) ──
  const sfxBuffers = new Map<SfxId, AudioBuffer>();
  const bgmSounds = new Map<string, LoadedSound>();

  // ── SFX bus state ─────────────────────────────────────────────────────────────
  const lastPlay = new Map<SfxId, number>();
  const activeVoices: AudioBufferSourceNode[] = [];

  const play = (id: SfxId, x?: number, n?: number): void => {
    if (audioCtx.state !== "running") return;
    const buf = sfxBuffers.get(id);
    if (!buf) return;
    const now = audioCtx.currentTime;
    if (now - (lastPlay.get(id) ?? -Infinity) < SFX_THROTTLE) return;
    lastPlay.set(id, now);

    if (activeVoices.length >= MAX_VOICES) {
      const oldest = activeVoices.shift();
      try {
        oldest?.stop();
      } catch {
        /* already stopped */
      }
    }

    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const gain = audioCtx.createGain();
    // A larger batch (bullets cancelled, items collected) reads a touch louder — capped
    // so it never dominates. Presentation-only; `n` never re-enters sim logic.
    gain.gain.value = n && n > 1 ? Math.min(1.5, 1 + Math.log2(n) * 0.12) : 1;
    const pan = audioCtx.createStereoPanner();
    pan.pan.value = x === undefined ? 0 : Math.max(-1, Math.min(1, (x / PLAYFIELD_W) * 2 - 1));
    src.connect(gain).connect(pan).connect(sfxMaster);
    src.start(now);
    activeVoices.push(src);
    src.onended = (): void => {
      const i = activeVoices.indexOf(src);
      if (i >= 0) activeVoices.splice(i, 1);
    };
  };

  const playEvents = (events: readonly SfxEvent[]): void => {
    for (const e of events) play(e.id, e.x, e.n);
  };

  // ── BGM player state ──────────────────────────────────────────────────────────
  let currentTrack: string | null = null; // what IS playing
  let desiredTrack: string | null = null; // what we WANT playing
  let activeChannel: GainNode = bgmA;
  let activeSource: AudioBufferSourceNode | null = null;

  const startTrack = (sound: LoadedSound, channel: GainNode): AudioBufferSourceNode => {
    const src = audioCtx.createBufferSource();
    src.buffer = sound.buffer;
    src.loop = true;
    src.loopStart = sound.loopStart;
    src.loopEnd = sound.loopEnd;
    src.connect(channel);
    src.start(audioCtx.currentTime);
    return src;
  };

  // Bring the running BGM in line with `desiredTrack`. Called by playBgm, on resume, and
  // whenever a track buffer finishes loading (in case it was the desired-but-unloaded
  // one). Idempotent: no-ops unless the desired track differs AND is available.
  const sync = (): void => {
    if (audioCtx.state !== "running") return; // resume() re-syncs once running
    if (desiredTrack === currentTrack) return;
    let sound: LoadedSound | null = null;
    if (desiredTrack !== null) {
      sound = bgmSounds.get(desiredTrack) ?? null;
      if (!sound) return; // not loaded yet — leave current playing; preload re-syncs
    }
    const now = audioCtx.currentTime;
    // Fade out the current channel + stop its source after the fade.
    activeChannel.gain.cancelScheduledValues(now);
    activeChannel.gain.setValueAtTime(activeChannel.gain.value, now);
    activeChannel.gain.linearRampToValueAtTime(0, now + BGM_FADE);
    if (activeSource) {
      const old = activeSource;
      try {
        old.stop(now + BGM_FADE + 0.05);
      } catch {
        /* already stopped */
      }
    }

    if (sound === null) {
      currentTrack = null;
      activeSource = null;
      return;
    }
    // Fade in the new track on the other channel.
    const inChannel = activeChannel === bgmA ? bgmB : bgmA;
    inChannel.gain.cancelScheduledValues(now);
    inChannel.gain.setValueAtTime(0, now);
    inChannel.gain.linearRampToValueAtTime(1, now + BGM_FADE);
    activeSource = startTrack(sound, inChannel);
    activeChannel = inChannel;
    currentTrack = desiredTrack;
    // A real track just started playing — report it (unlock-on-hear). Fires only on an
    // actual transition (this whole block is skipped when the desired track is unchanged),
    // so it never spams; the shell dedupes before persisting.
    if (currentTrack !== null) onTrackStart?.(currentTrack);
  };

  const playBgm = (trackId: string | null): void => {
    desiredTrack = trackId;
    sync();
  };

  const resume = (): void => {
    void audioCtx
      .resume()
      .then(sync)
      .catch(() => {
        /* resume can reject if the context is closed — nothing to do */
      });
  };

  const preload = (manifest: AudioManifest): void => {
    // SFX: resolve every SfxId's effective source (manifest override, else engine
    // default). `DEFAULT_SFX` has an entry per id, so this covers the full set.
    for (const key of Object.keys(DEFAULT_SFX)) {
      const id = Number(key) as SfxId;
      const source: SoundSource = manifest.sfx?.[id] ?? { kind: "synth", gen: DEFAULT_SFX[id] };
      void resolveSource(source, audioCtx).then((loaded) => {
        if (loaded) sfxBuffers.set(id, loaded.buffer);
      });
    }
    // BGM: resolve every declared track; re-sync on each land so a desired-but-pending
    // track (e.g. the title theme, requested before its buffer was ready) starts.
    for (const track of Object.values(manifest.bgm)) {
      void resolveSource(track.source, audioCtx).then((loaded) => {
        if (loaded) {
          bgmSounds.set(track.id, loaded);
          sync();
        }
      });
    }
  };

  return { preload, resume, play, playEvents, playBgm, applyVolumes };
}
