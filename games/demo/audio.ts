// The reference game's audio manifest.
//
// Its SPECIFIC BGM tracks are game identity, so they live here (not in the engine),
// composed from the engine's synth toolkit `bgmLoop` (the engine ships default SFX + the
// toolkit, never stock BGM). Each is a functional placeholder
// loop, distinct per screen. Swapping any one for a real file is a one-line change:
//   source: { kind: "synth", gen: bgmLoop({...}) }
//   →       { kind: "url", src: "/audio/boss.ogg", loopStart, loopEnd }
// and nothing else in the game or engine changes.
//
// There is NO `sfx` map: the demo uses the engine's default sound for every SfxId — the
// zero-config soundscape a minimal game gets for free. Overriding one is just adding an
// entry keyed by `SfxId`.

import { bgmLoop, defineBgm, type AudioManifest } from "higan";
// The Extra BOSS theme is a REAL audio file — the reference example of a `kind: "url"` BGM
// (every other track here is a procedural synth placeholder). It scores the climax (the boss
// fight, the stage's longest sustained stretch), so the Extra stage's signature sound is the
// real track; the waves use a synth stage theme, so crossing into the boss is also a musical
// shift from placeholder to real file. Imported through Vite so it resolves to a base-relative
// hashed URL in the build; the engine fetches + decodes it exactly like the synth tracks
// resolve to a buffer, so nothing else in the game or engine changes.
//
// Attribution (CC-BY 4.0, required): "Crypto" by Kevin MacLeod (https://incompetech.com/),
// licensed under Creative Commons By Attribution 4.0. Also credited in the README.
import extraThemeUrl from "./assets/audio/extra-theme.mp3";

// Distinct loops: calm title, mid-tempo stage, driving minor boss, resolving results.
// Chords are semitone offsets from each track's root; the first offset is the bass note.
const titleTheme = bgmLoop({
  bpm: 84,
  root: 60, // C4
  wave: "triangle",
  introBars: 1,
  gain: 0.45,
  progression: [
    [0, 4, 7], // C
    [-3, 0, 4], // Am
    [5, 9, 12], // F
    [7, 11, 14], // G
  ],
});

const stageTheme = bgmLoop({
  bpm: 124,
  root: 57, // A3
  wave: "triangle",
  introBars: 1,
  gain: 0.5,
  progression: [
    [0, 3, 7], // Am
    [-4, 0, 3], // F
    [3, 7, 10], // C
    [-2, 2, 5], // G
  ],
});

const bossTheme = bgmLoop({
  bpm: 152,
  root: 57, // A3
  wave: "sawtooth",
  introBars: 0, // jump straight into the loop — tension, no lead-in
  gain: 0.42,
  progression: [
    [0, 3, 7], // Am
    [0, 3, 7], // Am
    [5, 8, 12], // Dm
    [7, 11, 14], // E
  ],
});

// Stage 2 leans moodier (lower root, slower) than Stage 1's stage theme; its boss theme
// swaps boss 1's sawtooth for a harder square timbre so the two encounters read distinct.
const stage2Theme = bgmLoop({
  bpm: 112,
  root: 55, // G3
  wave: "triangle",
  introBars: 1,
  gain: 0.5,
  progression: [
    [0, 3, 7], // Gm
    [-2, 3, 5], // Eb
    [5, 8, 12], // Cm
    [2, 5, 9], // D
  ],
});

const boss2Theme = bgmLoop({
  bpm: 160,
  root: 53, // F3
  wave: "square",
  introBars: 0, // straight into the loop — tension, no lead-in
  gain: 0.4,
  progression: [
    [0, 3, 7], // Fm
    [0, 3, 7], // Fm
    [-2, 3, 5], // Db
    [7, 10, 14], // C
  ],
});

// Stage 3 goes grand and solemn — the lowest, statliest root of the three stage themes (a
// deep, still starlit night). Its boss theme is the campaign's fastest and most driving, a
// sawtooth finale distinct from boss 1's duel and boss 2's square verse.
const stage3Theme = bgmLoop({
  bpm: 108,
  root: 50, // D3
  wave: "triangle",
  introBars: 1,
  gain: 0.5,
  progression: [
    [0, 3, 7], // Dm
    [5, 8, 12], // Gm
    [-2, 2, 5], // C
    [3, 7, 10], // F
  ],
});

const boss3Theme = bgmLoop({
  bpm: 168,
  root: 50, // D3
  wave: "sawtooth",
  introBars: 0, // straight into the loop — the climax, no lead-in
  gain: 0.4,
  progression: [
    [0, 3, 7], // Dm
    [0, 3, 7], // Dm
    [5, 8, 12], // Gm
    [7, 11, 14], // A
  ],
});

// The Extra STAGE theme (the waves) is a synth placeholder — fast and hard-edged, the
// campaign's driving sawtooth pushed up in tempo for the post-clear stage; the boss then
// swaps it for the real audio file (see the import above).
const extraStageTheme = bgmLoop({
  bpm: 178,
  root: 45, // A2 — the lowest, heaviest root
  wave: "sawtooth",
  introBars: 1,
  gain: 0.4,
  progression: [
    [0, 3, 7], // Am
    [0, 3, 7], // Am
    [-3, 0, 5], // F
    [8, 12, 15], // Fmaj-ish lift
  ],
});

const resultsTheme = bgmLoop({
  bpm: 100,
  root: 60, // C4
  wave: "triangle",
  introBars: 1,
  gain: 0.5,
  progression: [
    [5, 9, 12], // F
    [7, 11, 14], // G
    [0, 4, 7], // C
    [0, 4, 7], // C
  ],
});

// Named once; referenced by handle everywhere else (StageDef.music, shell, and here) —
// a typo (`demoBgm.stage2`) is a compile error, not silent silence.
export const demoBgm = defineBgm({
  title: { title: "Higan ~ Prologue", source: { kind: "synth", gen: titleTheme } },
  stage1: { title: "Crimson Approach", source: { kind: "synth", gen: stageTheme } },
  boss1: { title: "Scarlet Duel", source: { kind: "synth", gen: bossTheme } },
  stage2: { title: "Emberfall Dusk", source: { kind: "synth", gen: stage2Theme } },
  boss2: { title: "The Songstress's Verse", source: { kind: "synth", gen: boss2Theme } },
  stage3: { title: "Starlit Ascent", source: { kind: "synth", gen: stage3Theme } },
  boss3: { title: "Sovereign of the Long Night", source: { kind: "synth", gen: boss3Theme } },
  extra: { title: "Flowers of the Far Shore", source: { kind: "synth", gen: extraStageTheme } },
  // The Extra boss theme — the one real audio FILE in the game (see the import above).
  bossExtra: { title: "Warden of the Crimson Shore", source: { kind: "url", src: extraThemeUrl } },
  results: { title: "Afterglow", source: { kind: "synth", gen: resultsTheme } },
});

export const demoAudio: AudioManifest = {
  bgm: demoBgm,
  shell: { title: demoBgm.title, results: demoBgm.results },
};
