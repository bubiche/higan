// Content hot-reload wiring — the engine half of live editing.
//
// A game iterates on its content (stage/wave scripts, bosses, midbosses, enemy AIs)
// by hot-reloading: edit a script, save, and the running scene rebuilds + replays to
// the current tick with the new code (the DX the engine is built around). This module
// packages the reusable part of that — extract the new game definition, re-check it,
// swap it into the live in-game screen, resync — so a game's bootstrap is one call.
//
// WHY THE `accept` CALL STAYS IN THE GAME'S BOOTSTRAP (the gotcha this encapsulates):
// Vite ties `import.meta.hot` to the module that owns it and resolves an `accept(dep,
// cb)` dep from a STATIC string literal in that module's source — so the
// `import.meta.hot.accept("./<root>", …)` line must live in the game's bootstrap, not
// here. This helper only builds `cb`. And the dep you accept must be your COMPOSITION
// ROOT (the module that calls `defineGame`), because every content module is imported
// through it: Vite full-reloads if ANY import path from an edited module to the entry
// lacks an accepting boundary, and accepting a leaf module leaves the root's own import
// path unbounded. Keep the root the only content your bootstrap imports directly.
//
//   if (import.meta.hot) {
//     import.meta.hot.accept(
//       "./game",                                   // <- your composition root, a literal
//       wireContentHMR({
//         app,
//         getDef: (mod) => (mod as { myGame: GameDefinition }).myGame,
//         verify: (def) => assertDeterministic(def.stages[0]!, stageSeed, input, dt, character),
//       }),
//     );
//   }

import { asInGame } from "./screens/ingame";
import type { AppHandle } from "./app";
import type { GameDefinition } from "../api/game";

export interface ContentHMRConfig {
  /** The running app (its router's top screen is resynced if it's the in-game one). */
  readonly app: AppHandle;
  /** Pull the `GameDefinition` out of the freshly-imported root module (untyped, so
   *  the caller names the export, e.g. `(mod) => (mod as { myGame }).myGame`). */
  readonly getDef: (mod: unknown) => GameDefinition;
  /** Optional purity tripwire: re-run a determinism check against the new content on
   *  each swap, so a non-deterministic edit THROWS at hot-reload time (Vite surfaces
   *  it and the live scene keeps the old code) rather than silently corrupting replays.
   *  The game supplies it (it owns the seed / input / character the check needs), and it
   *  runs BEFORE the swap commits — a throw leaves the running game on the old content. */
  readonly verify?: (def: GameDefinition) => void;
}

/**
 * Build the Vite hot-accept callback for live content editing. Pass the result to
 * `import.meta.hot.accept("<your composition root>", …)` in your game's bootstrap
 * (see the module header for why the `accept` literal must live there, not here).
 *
 * On each reload it pulls the new definition, runs `verify` (if given), swaps it into
 * the shell (so the NEXT run — retry / return-to-title → start — uses it), then resyncs
 * the live in-game screen so a run already in progress updates immediately. If the top
 * screen isn't the in-game one (you're on a menu), only the swap happens — the next run
 * still picks up the new content.
 */
export function wireContentHMR(config: ContentHMRConfig): (mod: unknown) => void {
  return (mod) => {
    if (!mod) return;
    const def = config.getDef(mod);
    config.verify?.(def); // throws before the swap commits if the new content isn't deterministic
    config.app.reloadDef(def); // fresh runs read this
    asInGame(config.app.router.top)?.hotReloadStage(); // live run rebuilds from it now
    console.info("[higan] content hot-reloaded");
  };
}
