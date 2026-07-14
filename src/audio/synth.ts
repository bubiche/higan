// The synth toolkit — the engine's default SFX and the reusable BGM loop-composer.
//
// This is ENGINE audio content: the engine ships a default sound
// for every SfxId (so a zero-config game is fully audible) and a `bgmLoop` composer so a
// game can author functional placeholder BGM with no audio files. It does NOT ship any
// game-specific BGM track — a game composes its own tracks from `bgmLoop` (the demo does,
// in games/demo/audio.ts). Music is game identity; the engine imposes none.
//
// Everything here is PRESENTATION: it runs entirely outside the sim, so plain
// `Math.random`/`Math` is fine (no determinism constraint). It is also placeholder — the
// whole file deletes cleanly once real audio files land (a manifest flips `kind: "synth"`
// → `kind: "url"` and stops referencing these).
//
// HEADLESS-SAFETY INVARIANT (load-bearing): this module is pulled into Node by any
// harness that imports a game whose manifest calls `bgmLoop` (e.g. the determinism
// verify harnesses import the demo game). So NO Web Audio object may be constructed at
// module-eval or spec-construction time — `bgmLoop(...)` and `DEFAULT_SFX` build only
// plain data (a `render` closure is deferred). Every `ctx.createX()` lives INSIDE a
// `render(ctx)` body, which the audio engine calls only in a real browser at preload.

import type { SynthGen } from "../api/audio";
import { SfxId } from "../core/events";

/** MIDI note number → frequency in Hz (A4 = note 69 = 440Hz). */
const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Schedule one enveloped oscillator voice onto `dest`. `at`/`dur` are seconds from the
 *  buffer start. A fast attack + exponential decay to silence gives a clean pluck; pass
 *  `freqEnd` for a pitch slide (the blip/sweep character). */
function osc(
  ctx: BaseAudioContext,
  dest: AudioNode,
  o: {
    at: number;
    dur: number;
    freq: number;
    freqEnd?: number;
    type?: OscillatorType;
    gain?: number;
    attack?: number;
  },
): void {
  const g = ctx.createGain();
  const peak = o.gain ?? 0.3;
  const attack = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(peak, o.at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
  g.connect(dest);

  const node = ctx.createOscillator();
  node.type = o.type ?? "square";
  node.frequency.setValueAtTime(o.freq, o.at);
  if (o.freqEnd !== undefined) {
    node.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), o.at + o.dur);
  }
  node.connect(g);
  node.start(o.at);
  node.stop(o.at + o.dur + 0.02);
}

/** Schedule a filtered white-noise burst (impacts, sweeps). */
function noise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  o: { at: number; dur: number; gain?: number; cutoff?: number; highpass?: boolean },
): void {
  const len = Math.max(1, Math.floor(o.dur * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = o.highpass ? "highpass" : "lowpass";
  filter.frequency.value = o.cutoff ?? 2000;

  const g = ctx.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(peak, o.at);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);

  src.connect(filter).connect(g).connect(dest);
  src.start(o.at);
  src.stop(o.at + o.dur + 0.02);
}

/** Build a one-shot SFX generator (no loop) from a render pass. */
function sfx(durationSec: number, render: (ctx: OfflineAudioContext) => void): SynthGen {
  return { durationSec, render };
}

// ── The engine's default SFX — one per SfxId (engine owns these) ──────────────
// Each is short, distinct, and cheap. A game overrides any id via the manifest's `sfx`
// map; every id it omits uses the default here, so a game that authors zero SFX still
// has the full set.
//
// MIX (relative loudness): the RAPID-FIRE sounds — Shoot (every few ticks), EnemyShoot
// (every boss ring/fan), Graze, EnemyHit, ItemCollect — are kept deliberately quiet so a
// steady stream of them sits UNDER the BGM (the BGM's own voices are pre-attenuated ~2× by
// `bgmLoop`'s internal level, so an un-attenuated SFX at the same nominal gain reads much
// louder). The PUNCTUATION sounds (Bomb, EnemyDeath, Laser, spells, Pichuun, Extend) stay
// prominent — they fire rarely and are meant to be heard over everything.
export const DEFAULT_SFX: Record<SfxId, SynthGen> = {
  // gameplay
  [SfxId.Shoot]: sfx(0.12, (c) => osc(c, c.destination, { at: 0, dur: 0.08, freq: 880, freqEnd: 440, type: "square", gain: 0.06 })),
  [SfxId.Graze]: sfx(0.1, (c) => osc(c, c.destination, { at: 0, dur: 0.06, freq: 2400, type: "sine", gain: 0.1 })),
  [SfxId.EnemyHit]: sfx(0.08, (c) => osc(c, c.destination, { at: 0, dur: 0.05, freq: 520, freqEnd: 360, type: "square", gain: 0.07 })),
  [SfxId.EnemyDeath]: sfx(0.32, (c) => {
    noise(c, c.destination, { at: 0, dur: 0.28, gain: 0.32, cutoff: 3200 });
    osc(c, c.destination, { at: 0, dur: 0.26, freq: 420, freqEnd: 90, type: "triangle", gain: 0.22 });
  }),
  [SfxId.Bomb]: sfx(0.7, (c) => {
    osc(c, c.destination, { at: 0, dur: 0.6, freq: 180, freqEnd: 40, type: "sawtooth", gain: 0.32, attack: 0.02 });
    noise(c, c.destination, { at: 0, dur: 0.6, gain: 0.34, cutoff: 1400 });
  }),
  [SfxId.SpellDeclare]: sfx(0.6, (c) => {
    // rising chord stab (minor triad sweeping up)
    for (const m of [57, 60, 64]) osc(c, c.destination, { at: 0, dur: 0.5, freq: mtof(m), freqEnd: mtof(m + 7), type: "sawtooth", gain: 0.12, attack: 0.03 });
  }),
  [SfxId.SpellCapture]: sfx(0.7, (c) => {
    // bright resolving major arpeggio
    const notes = [72, 76, 79, 84];
    notes.forEach((m, i) => osc(c, c.destination, { at: i * 0.06, dur: 0.4, freq: mtof(m), type: "triangle", gain: 0.16 }));
  }),
  [SfxId.ItemCollect]: sfx(0.14, (c) => {
    osc(c, c.destination, { at: 0, dur: 0.05, freq: mtof(84), type: "square", gain: 0.06 });
    osc(c, c.destination, { at: 0.05, dur: 0.06, freq: mtof(88), type: "square", gain: 0.06 });
  }),
  [SfxId.Extend]: sfx(0.5, (c) => {
    // celebratory ascending arpeggio
    [72, 76, 79, 84, 88].forEach((m, i) => osc(c, c.destination, { at: i * 0.07, dur: 0.16, freq: mtof(m), type: "triangle", gain: 0.2 }));
  }),
  [SfxId.Pichuun]: sfx(0.62, (c) => {
    // The classic Touhou death whistle — one continuous "pi→chuuun" gesture: a fast bright
    // up-chirp ("pi") that hands straight off (matched pitch at the seam) into a long
    // descending whistle ("chuuun"). Two slightly-detuned sines on the tail beat against each
    // other as they fall — that shimmering warble is the recognizable part; a triangle an
    // octave below adds weight, and a breath of high-passed air softens the onset.
    const d = c.destination;
    osc(c, d, { at: 0, dur: 0.05, freq: 720, freqEnd: 1950, type: "sine", gain: 0.24, attack: 0.004 });
    osc(c, d, { at: 0.05, dur: 0.55, freq: 1950, freqEnd: 90, type: "sine", gain: 0.3, attack: 0.004 });
    osc(c, d, { at: 0.05, dur: 0.55, freq: 1962, freqEnd: 96, type: "sine", gain: 0.13, attack: 0.004 });
    osc(c, d, { at: 0.05, dur: 0.5, freq: 975, freqEnd: 60, type: "triangle", gain: 0.1, attack: 0.006 });
    noise(c, d, { at: 0, dur: 0.09, gain: 0.06, cutoff: 4000, highpass: true });
  }),
  [SfxId.Cancel]: sfx(0.35, (c) => {
    noise(c, c.destination, { at: 0, dur: 0.3, gain: 0.2, cutoff: 5000, highpass: true });
    osc(c, c.destination, { at: 0, dur: 0.28, freq: 300, freqEnd: 1600, type: "sine", gain: 0.12 });
  }),
  [SfxId.PlayerDeathBomb]: sfx(0.6, (c) => {
    // softer/brighter cousin of Bomb — a defensive whoosh
    osc(c, c.destination, { at: 0, dur: 0.5, freq: 240, freqEnd: 60, type: "triangle", gain: 0.28, attack: 0.02 });
    noise(c, c.destination, { at: 0, dur: 0.5, gain: 0.24, cutoff: 2600 });
  }),
  [SfxId.EnemyShoot]: sfx(0.1, (c) => {
    // A soft, low "pon" — rapid-fire, so quiet and rounded (sine), and pitched well below the
    // player's brighter 880→440 square `Shoot` so the two never blur together in a dense fight.
    osc(c, c.destination, { at: 0, dur: 0.07, freq: 320, freqEnd: 200, type: "sine", gain: 0.05 });
  }),
  [SfxId.Laser]: sfx(0.34, (c) => {
    // A beam "vwoom": a sustained sawtooth body sweeping down for weight, a bright detuned top
    // for the zap, and a short filtered-noise transient at the head. Prominent — beams fire rarely.
    osc(c, c.destination, { at: 0, dur: 0.3, freq: 260, freqEnd: 150, type: "sawtooth", gain: 0.2, attack: 0.008 });
    osc(c, c.destination, { at: 0, dur: 0.28, freq: 1240, freqEnd: 720, type: "square", gain: 0.06 });
    noise(c, c.destination, { at: 0, dur: 0.08, gain: 0.16, cutoff: 3600, highpass: true });
  }),
  // UI
  [SfxId.MenuMove]: sfx(0.06, (c) => osc(c, c.destination, { at: 0, dur: 0.04, freq: 660, type: "square", gain: 0.1 })),
  [SfxId.MenuConfirm]: sfx(0.16, (c) => {
    osc(c, c.destination, { at: 0, dur: 0.05, freq: mtof(72), type: "square", gain: 0.14 });
    osc(c, c.destination, { at: 0.05, dur: 0.08, freq: mtof(79), type: "square", gain: 0.14 });
  }),
  [SfxId.MenuCancel]: sfx(0.14, (c) => {
    osc(c, c.destination, { at: 0, dur: 0.05, freq: mtof(69), type: "square", gain: 0.12 });
    osc(c, c.destination, { at: 0.05, dur: 0.07, freq: mtof(62), type: "square", gain: 0.12 });
  }),
  [SfxId.Pause]: sfx(0.1, (c) => osc(c, c.destination, { at: 0, dur: 0.07, freq: 520, type: "sine", gain: 0.12 })),
};

// ── The reusable BGM loop-composer (§0.4: engine ships the toolkit, not the tracks) ──

/** A functional placeholder BGM track: a chord progression rendered as bass + arp + a
 *  sparse lead, with an optional intro before a seamless loop body. A game passes a
 *  distinct spec per track (tempo / progression / mood) to get distinct-sounding loops;
 *  swap for a real file later with zero other change. */
export interface BgmSpec {
  /** Tempo in beats per minute. */
  readonly bpm: number;
  /** Root MIDI note the progression is built over (e.g. 57 = A3). */
  readonly root: number;
  /** One entry per bar of the LOOP body: the chord as semitone offsets from `root`
   *  (e.g. `[0, 3, 7]` = a minor triad). The first offset is the bass note. */
  readonly progression: readonly (readonly number[])[];
  /** Bars of intro (a lead-in over the first chord) played once before the loop. 0 =
   *  no intro, loop the whole buffer. Default 0. */
  readonly introBars?: number;
  /** Waveform for the arp/lead voices. Default "triangle". */
  readonly wave?: OscillatorType;
  /** Beats per bar. Default 4. */
  readonly beatsPerBar?: number;
  /** Overall level 0..1 (headroom for the crossfade + master). Default 0.5. */
  readonly gain?: number;
}

/** Compose a `SynthGen` from a `BgmSpec`. Pure data construction — the actual Web Audio
 *  scheduling is deferred into the returned `render` closure (headless-safe). */
export function bgmLoop(spec: BgmSpec): SynthGen {
  const beatsPerBar = spec.beatsPerBar ?? 4;
  const wave = spec.wave ?? "triangle";
  const level = spec.gain ?? 0.5;
  const introBars = spec.introBars ?? 0;
  const secPerBeat = 60 / spec.bpm;
  const secPerBar = secPerBeat * beatsPerBar;
  const introSec = introBars * secPerBar;
  const loopSec = spec.progression.length * secPerBar;
  const durationSec = introSec + loopSec;

  const render = (ctx: OfflineAudioContext): void => {
    const master = ctx.createGain();
    master.gain.value = level;
    master.connect(ctx.destination);

    const bar = (barStart: number, chord: readonly number[], soft: boolean): void => {
      const bassM = spec.root + (chord[0] ?? 0) - 12;
      // Bass: one sustained note per bar.
      osc(ctx, master, { at: barStart, dur: secPerBar * 0.95, freq: mtof(bassM), type: "sine", gain: soft ? 0.18 : 0.26, attack: 0.02 });
      // Arp: eighth notes cycling the chord tones up an octave.
      const eighths = beatsPerBar * 2;
      const eighthDur = secPerBeat / 2;
      for (let i = 0; i < eighths; i++) {
        const tone = chord[i % chord.length] ?? 0;
        const octave = i >= eighths / 2 ? 12 : 0;
        osc(ctx, master, {
          at: barStart + i * eighthDur,
          dur: eighthDur * 0.9,
          freq: mtof(spec.root + tone + octave),
          type: wave,
          gain: soft ? 0.05 : 0.09,
        });
      }
      // Lead: a sustained chord-top on beats 1 and 3 (skipped in the softer intro).
      if (!soft) {
        const topM = spec.root + (chord[chord.length - 1] ?? 0) + 12;
        osc(ctx, master, { at: barStart, dur: secPerBeat * 1.8, freq: mtof(topM), type: wave, gain: 0.08, attack: 0.03 });
        osc(ctx, master, { at: barStart + secPerBeat * 2, dur: secPerBeat * 1.8, freq: mtof(topM + 2), type: wave, gain: 0.07, attack: 0.03 });
      }
    };

    // Intro: soft lead-in over the first chord.
    for (let b = 0; b < introBars; b++) bar(b * secPerBar, spec.progression[0] ?? [0], true);
    // Loop body: the full progression, once.
    for (let b = 0; b < spec.progression.length; b++) bar(introSec + b * secPerBar, spec.progression[b] ?? [0], false);
  };

  return introBars > 0 ? { durationSec, loopStart: introSec, loopEnd: durationSec, render } : { durationSec, render };
}
