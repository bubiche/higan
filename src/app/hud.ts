// The demo's side HUD: a Touhou-style status panel beside the playfield.
//
// It reads simulation state every frame and keeps NO counters of its own — the sim
// is the single source of truth, so lives/bombs/graze/spell-timer always match the
// deterministic state that folds into the hash. (A display-side counter would let
// the panel drift from the truth and quietly lie during a replay.)
//
// Everything here is demo-layer presentation: out of the simulation, out of the
// hash. `beams` and `drawn` are the renderer's per-frame draw-call counts (not sim
// state), so they're threaded in rather than read off the sim.

import type { Simulation } from "../core/sim";
import type { SimDriver } from "../core/runtime";

/** Per-frame render-side numbers the panel shows but the sim doesn't own. */
export interface HudFrame {
  /** Beams drawn this frame (laser renderer). */
  readonly beams: number;
  /** Bullet instances drawn this frame (bullet renderer). */
  readonly drawn: number;
  /** Last replay save/load outcome, shown verbatim (empty = nothing yet). */
  readonly replayStatus: string;
}

const STATE_LABELS = ["alive", "dying", "respawn", "GAME OVER"] as const;

// Icon rows stay compact even with a generous life/bomb count.
const ICON_CAP = 10;
function iconRow(count: number, icon: string): string {
  if (count <= 0) return "—";
  if (count <= ICON_CAP) return icon.repeat(count);
  return `${icon.repeat(ICON_CAP)} +${count - ICON_CAP}`;
}

const GAUGE_CELLS = 18;
function gauge(ratio: number): string {
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  const filled = Math.round(clamped * GAUGE_CELLS);
  return "#".repeat(filled) + "-".repeat(GAUGE_CELLS - filled);
}

/** The side HUD handle: call `update` once per rendered frame. */
export interface Hud {
  update(sim: Simulation, driver: SimDriver, frame: HudFrame): void;
}

/**
 * Build the side HUD over `panel` (a white-space:pre text element). Returns an
 * `update` to call once per rendered frame with the current sim/driver and the
 * frame's render-side numbers.
 */
export function createHud(panel: HTMLElement): Hud {
  return {
    update(sim, driver, frame) {
      const { player } = sim;
      const lines: string[] = [];

      lines.push("── player ──");
      lines.push(`lives   ${iconRow(player.lives, "✦")}`);
      lines.push(`bombs   ${iconRow(player.bombs, "✸")}`);
      lines.push(`power   ${player.power}`);
      lines.push(`points  ${player.pointItemsCollected}`);
      lines.push(`graze   ${player.graze}`);
      const stateLabel = STATE_LABELS[player.state] ?? "?";
      lines.push(`state   ${stateLabel}${player.invulnTicks > 0 ? ` (inv ${player.invulnTicks})` : ""}`);

      // `sim.boss` is non-null only while a boss is on the field (midboss or final);
      // it clears between encounters, so there's no defeated state to show here — the
      // run ends from `stageComplete`, not a boss's defeat.
      const boss = sim.boss;
      if (boss) {
        lines.push("");
        lines.push("── boss ──");
        if (boss.active) {
          const ratio = boss.hpMax > 0 ? boss.hp / boss.hpMax : 0;
          lines.push(`spell   ${boss.name}${boss.isSpell ? "  ✦" : ""}`);
          lines.push(`hp      [${gauge(ratio)}] ${Math.ceil(boss.hp)}`);
          lines.push(`timer   ${(boss.timeLeft / 60).toFixed(1)}s`);
          lines.push(`capture ${player.spellCapturedNoMiss ? "intact (shoot to capture)" : "missed"}`);
        } else {
          lines.push("(between phases)");
        }
      }

      lines.push("");
      lines.push("── debug ──");
      lines.push(`tick    ${driver.tick}`);
      lines.push(`phase   ${sim.patternName}`);
      lines.push(`bullets ${sim.system.liveCount}`);
      lines.push(`shots   ${sim.shots.liveCount}`);
      lines.push(`enemies ${sim.enemies.liveCount}`);
      lines.push(`items   ${sim.items.liveCount}`);
      lines.push(`beams   ${frame.beams}`);
      lines.push(`drawn   ${frame.drawn}`);
      lines.push(`hash    0x${sim.hash().toString(16).padStart(8, "0")}`);
      lines.push(`speed   ${driver.speed}x${driver.paused ? "   ❚❚ PAUSED" : ""}`);

      lines.push("");
      lines.push("── replay ──");
      lines.push(frame.replayStatus || "Z to shoot · save/load below");

      panel.textContent = lines.join("\n");
    },
  };
}
