// The reference game definition.
//
// This is the engine/game boundary in practice: the game is authored entirely as
// data handed to `defineGame`, importing only the public API and its own content.
// The shell runs over this — nothing under `src/` knows it exists.
//
// For now it is a single stage (the demo boss) and one default character. The
// engine's sim economy work (player shots, enemies, items, scoring, multiple
// stages) expands what a stage and character carry; this grows with it.

import { defineGame, Shape, type ShotConfig } from "../../src/api";
import { DEFAULT_PLAYER_CONFIG } from "../../src/touhou/player";
import { DEMO_BOSS } from "./patterns/boss";
import { demoStage } from "./patterns/stage";

// The reference character's shot — authored content (a different game defines its
// own with zero engine change). A pale needle that points along travel: focus
// concentrates it into a tight column for high single-target DPS on the boss;
// unfocus fans it wider. Power widens the volley (flat until items feed power).
const DEMO_SHOT: ShotConfig = {
  fireInterval: 4,
  speed: 640,
  damage: 10,
  radius: 5,
  sprite: Shape.Kunai,
  color: [0.6, 0.9, 1.0],
  baseStreams: 2,
  powerPerStream: 32,
  maxStreams: 6,
  spread: 0.16,
  focusSpreadFrac: 0.2,
};

export const demoGame = defineGame({
  title: "HIGAN",
  seed: 0x1a9e,
  stages: [{ id: "stage-1", script: demoStage, boss: DEMO_BOSS }],
  characters: [{ id: "default", config: DEFAULT_PLAYER_CONFIG, shot: DEMO_SHOT }],
});
