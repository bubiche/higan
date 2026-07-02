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
  results: { title: "Afterglow", source: { kind: "synth", gen: resultsTheme } },
});

export const demoAudio: AudioManifest = {
  bgm: demoBgm,
  shell: { title: demoBgm.title, results: demoBgm.results },
};
