// The reference game definition.
//
// This is the engine/game boundary in practice: the game is authored entirely as
// data handed to `defineGame`, importing only the public API and its own content.
// The shell runs over this — nothing under `src/` knows it exists.
//
// For now it is a single stage (the demo boss) and one default character. The
// engine's sim economy work (player shots, enemies, items, scoring, multiple
// stages) expands what a stage and character carry; this grows with it.

import { defineGame } from "../../src/api";
import { DEFAULT_PLAYER_CONFIG } from "../../src/touhou/player";
import { DEMO_BOSS } from "./patterns/boss";

export const demoGame = defineGame({
  title: "HIGAN",
  seed: 0x1a9e,
  stages: [{ id: "stage-1", boss: DEMO_BOSS }],
  characters: [{ id: "default", config: DEFAULT_PLAYER_CONFIG }],
});
