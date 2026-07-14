// Headless proof — the hi-score VIEWER (reader half).
//
// The Records grid and the character-select best line can only be eyeballed in a browser, but
// the READ they rest on (`readHiScore`) is a pure function in save.ts, so the contract IS
// unit-testable here. The one real trap is a reader that recomposes the save key with the
// wrong separator (the key uses NUL, which the terminal renders as a space): it would silently
// return null and every cell would show "—", looking correct on a fresh save. This asserts the
// reader reads back exactly what the writer wrote (same-key round-trip), that an unset pairing
// reads null, and that the char-select "best across all difficulties" scan picks the max and
// its difficulty — including null when a character has no score.

import { hiScoreKey, readHiScore, recordHiScore, DEFAULT_SAVE, type SaveData } from "../src/app/save";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${detail}`);
  if (!pass) failures++;
};

const freshSave = (): SaveData => ({ ...DEFAULT_SAVE, hiScores: {} });

const DIFFS = [
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
  { id: "lunatic", label: "Lunatic" },
];

// The char-select scan, replicated so the test pins the logic (the screen version reads
// shell.save/def; this is the same shape over a plain save + difficulty list).
const bestAcross = (
  save: SaveData,
  characterId: string,
  diffs: readonly { id: string; label: string }[],
): { score: number; label: string } | null => {
  let best: { score: number; label: string } | null = null;
  for (const d of diffs) {
    const s = readHiScore(save, characterId, d.id);
    if (s !== null && (best === null || s > best.score)) best = { score: s, label: d.label };
  }
  return best;
};

// ── Reader ↔ writer key agreement (the separator trap) ────────────────────────
const s = freshSave();
check("unset pairing reads null", readHiScore(s, "Focus", "normal") === null);
recordHiScore(s, "Focus", "normal", 12345);
check("reader reads back what the writer wrote", readHiScore(s, "Focus", "normal") === 12345);
check(
  "...through the same key the writer used",
  readHiScore(s, "Focus", "normal") === s.hiScores[hiScoreKey("Focus", "normal")],
);
check("a sibling pairing still reads null", readHiScore(s, "Focus", "lunatic") === null);
check("a different character reads null", readHiScore(s, "Spread", "normal") === null);

// ── best-across-difficulties scan (the char-select line) ──────────────────────
check("no score for a character → best is null", bestAcross(freshSave(), "Spread", DIFFS) === null);

const m = freshSave();
recordHiScore(m, "Focus", "easy", 2000);
recordHiScore(m, "Focus", "normal", 5000);
recordHiScore(m, "Focus", "lunatic", 9000);
const best = bestAcross(m, "Focus", DIFFS);
check("best picks the maximum score across difficulties", best?.score === 9000, `got ${best?.score}`);
check("...and annotates the difficulty that produced it", best?.label === "Lunatic", `got ${best?.label}`);
// A lower-ranked higher score must win over a higher-ranked lower score (it's a max, not a rank order).
const r = freshSave();
recordHiScore(r, "Spread", "easy", 8000);
recordHiScore(r, "Spread", "lunatic", 3000);
const rb = bestAcross(r, "Spread", DIFFS);
check("the maximum wins regardless of rank", rb?.score === 8000 && rb?.label === "Easy", `got ${rb?.score}/${rb?.label}`);
// One character's scores never leak into another's scan.
check("another character's scan stays null", bestAcross(m, "Spread", DIFFS) === null);

console.log(failures === 0 ? "\n✓ PASS — hi-score reader round-trips + best-across scan\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
