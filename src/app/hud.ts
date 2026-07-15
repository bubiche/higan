// The side HUD: a player-facing Touhou status panel, plus a dev-only debug readout.
//
// It reads simulation state every frame and keeps NO counters of its own — the sim
// is the single source of truth, so lives/bombs/graze/power always match the
// deterministic state that folds into the hash. (A display-side counter would let
// the panel drift from the truth and quietly lie during a replay.)
//
// Two regions live in the panel:
//   • the PLAYER FACE — score/HiScore, lives, bombs, power, graze, points, difficulty,
//     title — always visible, the polished front the game ships with; and
//   • a DEBUG readout — tick/hash/entity/draw counts + the boss internals — created only
//     in a DEV build (`import.meta.env.DEV`, dead-stripped from production) and hidden by
//     default, revealed with the debug-toggle key. It keeps its authoring value without
//     being the face a player sees.
//
// Everything here is presentation: out of the simulation, out of the hash. `beams`/`drawn`
// are the renderer's per-frame draw-call counts (not sim state), so they're threaded in
// rather than read off the sim; `hiScore`/`maxPower`/`difficultyLabel`/`title` are run-level
// reads the sim doesn't own, threaded in for the same reason.

import type { Simulation } from "../core/sim";
import type { SimDriver } from "../core/runtime";

/** Per-frame values the panel shows but the sim doesn't own. */
export interface HudFrame {
  /** Beams drawn this frame (laser renderer). */
  readonly beams: number;
  /** Bullet instances drawn this frame (bullet renderer). */
  readonly drawn: number;
  /** Best score for this run's character×difficulty, taken as `max(saved, live)` by the
   *  caller so it ticks up live once the run passes the stored best. */
  readonly hiScore: number;
  /** The character's power ceiling (`maxPowerFor` its shot) — the `MAX` in `power / MAX`. */
  readonly maxPower: number;
  /** The run's difficulty display label (e.g. "Lunatic"). */
  readonly difficultyLabel: string;
  /** The game title, shown at the top of the player face. */
  readonly title: string;
}

const STATE_LABELS = ["alive", "dying", "respawn", "GAME OVER"] as const;

// Icon rows stay compact even with a generous life/bomb count.
const ICON_CAP = 8;
function iconRow(count: number, icon: string): string {
  if (count <= 0) return "—";
  if (count <= ICON_CAP) return icon.repeat(count);
  return `${icon.repeat(ICON_CAP)}+${count - ICON_CAP}`;
}

// Thousands-grouped integer for the score/PIV readouts (presentation only — the sim
// holds the exact integer; this never feeds the hash).
function grouped(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
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
  /** Toggle the dev debug readout's visibility. A no-op in a production build (the
   *  readout isn't created there). */
  toggleDebug(): void;
}

/** Build one label/value row into `parent`, returning the value span to update. */
function row(parent: HTMLElement, label: string): HTMLElement {
  const r = document.createElement("div");
  r.className = "hud-row";
  const l = document.createElement("span");
  l.className = "hud-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "hud-value";
  r.append(l, v);
  parent.appendChild(r);
  return v;
}

/**
 * Build the side HUD over `panel`. Returns an `update` to call once per rendered frame with
 * the current sim/driver and the frame's presentation values, plus a `toggleDebug` for the
 * dev readout. The player face is built once as a stable element tree; each frame writes only
 * the value spans (no per-frame DOM churn).
 */
export function createHud(panel: HTMLElement): Hud {
  panel.innerHTML = "";

  // ── Player face (always visible) ─────────────────────────────────────────────
  const face = document.createElement("div");
  face.className = "hud-face";

  const titleEl = document.createElement("div");
  titleEl.className = "hud-title";
  const diffEl = document.createElement("div");
  diffEl.className = "hud-diff";
  face.append(titleEl, diffEl);

  const scores = document.createElement("div");
  scores.className = "hud-section";
  const hiScoreVal = row(scores, "HiScore");
  const scoreVal = row(scores, "Score");
  face.appendChild(scores);

  const stats = document.createElement("div");
  stats.className = "hud-section";
  const livesVal = row(stats, "Player");
  const bombsVal = row(stats, "Bomb");
  const powerVal = row(stats, "Power");
  const grazeVal = row(stats, "Graze");
  const pointVal = row(stats, "Point");
  const pivVal = row(stats, "PIV");
  livesVal.classList.add("hud-icons");
  bombsVal.classList.add("hud-icons");
  face.appendChild(stats);

  panel.appendChild(face);

  // ── Debug readout (DEV only, hidden until toggled) ────────────────────────────
  // Created only in a dev build so production carries no debug DOM at all; `debug` is
  // null there and `toggleDebug` no-ops.
  const debug: HTMLPreElement | null = import.meta.env.DEV ? document.createElement("pre") : null;
  if (debug) {
    debug.className = "hud-debug";
    debug.hidden = true;
    panel.appendChild(debug);
  }

  return {
    update(sim, driver, frame): void {
      const { player } = sim;

      titleEl.textContent = frame.title;
      diffEl.textContent = frame.difficultyLabel;
      hiScoreVal.textContent = grouped(frame.hiScore);
      scoreVal.textContent = grouped(player.score);
      livesVal.textContent = iconRow(player.lives, "★");
      bombsVal.textContent = iconRow(player.bombs, "✦");
      powerVal.textContent = `${player.power} / ${frame.maxPower}`;
      grazeVal.textContent = grouped(player.graze);
      pointVal.textContent = grouped(player.pointItemsCollected);
      pivVal.textContent = grouped(player.piv);

      if (!debug || debug.hidden) return; // skip the debug string build unless it's shown

      const lines: string[] = [];
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
      const stateLabel = STATE_LABELS[player.state] ?? "?";
      lines.push(`state   ${stateLabel}${player.invulnTicks > 0 ? ` (inv ${player.invulnTicks})` : ""}`);

      // Boss internals — the on-field chrome (HP arc, spell timer, nameplate) is the player's
      // read; this mirrors it as raw numbers for debugging. `sim.boss` is non-null only while a
      // boss is on the field.
      const boss = sim.boss;
      if (boss) {
        lines.push("");
        lines.push("── boss ──");
        if (boss.active) {
          // A survival phase is invulnerable: its gauge is locked full (hp never drains) and the
          // objective is to OUTLAST the timer, so the capture line reads "survive" not "shoot".
          const ratio = boss.survival ? 1 : boss.hpMax > 0 ? boss.hp / boss.hpMax : 0;
          lines.push(`spell   ${boss.name}${boss.isSpell ? "  ✦" : ""}${boss.survival ? "  (survival)" : ""}`);
          lines.push(`hp      [${gauge(ratio)}] ${boss.survival ? "∞" : Math.ceil(boss.hp)}`);
          lines.push(`timer   ${(boss.timeLeft / 60).toFixed(1)}s`);
          const captureHint = player.spellCapturedNoMiss
            ? boss.survival
              ? "intact (survive to capture)"
              : "intact (shoot to capture)"
            : "missed";
          lines.push(`capture ${captureHint}`);
        } else {
          lines.push("(between phases)");
        }
      }

      debug.textContent = lines.join("\n");
    },
    toggleDebug(): void {
      if (debug) debug.hidden = !debug.hidden;
    },
  };
}
