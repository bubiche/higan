// The app shell's public surface — what a game's bootstrap imports.
//
// A game under `games/` boots by handing its definition to `runGame`. The router
// and the in-game hot-reload hook are exposed so a game's dev HMR can resync the
// running stage. Nothing here reaches into `games/`.

export { runGame, type AppHandle } from "./app";
export type { Screen, Router, Shell } from "./screen";
export { asInGame, type InGameScreen } from "./screens/ingame";
