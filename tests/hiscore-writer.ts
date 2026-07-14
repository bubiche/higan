// Headless proof — the hi-score writer.
//
// The results screen's DOM/BGM/persist wiring can only be eyeballed in a browser, but the
// WRITE itself (key composition + best-of merge) was deliberately factored into save.ts as
// pure functions so it IS unit-testable here. This asserts the record-keeping contract the
// results screen relies on: stable per-character×difficulty keys, keep-the-max, correct
// new-record signal, and independence across pairs.

import { hiScoreKey, recordHiScore, DEFAULT_SAVE, type SaveData } from "../src/app/save";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${detail}`);
  if (!pass) failures++;
};

const freshSave = (): SaveData => ({ ...DEFAULT_SAVE, hiScores: {} });

// ── Key composition ────────────────────────────────────────────────────────────
check("same pair → same key", hiScoreKey("Focus", "lunatic") === hiScoreKey("Focus", "lunatic"));
check("character differs → key differs", hiScoreKey("Focus", "lunatic") !== hiScoreKey("Spread", "lunatic"));
check("difficulty differs → key differs", hiScoreKey("Focus", "lunatic") !== hiScoreKey("Focus", "normal"));
// The NUL separator can't be produced by any printable id, so no "a|b" vs "a|" + "b" collision.
check(
  "separator can't be forged from ids",
  hiScoreKey("a", "bc") !== hiScoreKey("ab", "c") && hiScoreKey("a", "") !== hiScoreKey("", "a"),
);

// ── Best-of merge + new-record signal ─────────────────────────────────────────
const s = freshSave();
check("first score on an empty slot is a record", recordHiScore(s, "Focus", "normal", 1000) === true);
check("...and is stored", s.hiScores[hiScoreKey("Focus", "normal")] === 1000);
check("a higher score is a record", recordHiScore(s, "Focus", "normal", 2500) === true);
check("...and overwrites", s.hiScores[hiScoreKey("Focus", "normal")] === 2500);
check("a lower score is NOT a record", recordHiScore(s, "Focus", "normal", 900) === false);
check("...and does not overwrite", s.hiScores[hiScoreKey("Focus", "normal")] === 2500);
check("an equal score is NOT a record (strict best)", recordHiScore(s, "Focus", "normal", 2500) === false);
check("...and leaves the max intact", s.hiScores[hiScoreKey("Focus", "normal")] === 2500);
check("zero on an empty slot is not a record", recordHiScore(freshSave(), "Spread", "easy", 0) === false);

// ── Independence across character×difficulty ──────────────────────────────────
const m = freshSave();
recordHiScore(m, "Focus", "normal", 5000);
recordHiScore(m, "Focus", "lunatic", 3000);
recordHiScore(m, "Spread", "normal", 7000);
check("each pair keeps its own record", m.hiScores[hiScoreKey("Focus", "normal")] === 5000);
check("...unaffected by another difficulty", m.hiScores[hiScoreKey("Focus", "lunatic")] === 3000);
check("...unaffected by another character", m.hiScores[hiScoreKey("Spread", "normal")] === 7000);
check("exactly three slots written", Object.keys(m.hiScores).length === 3);
// Writing to one pair doesn't disturb a sibling.
recordHiScore(m, "Focus", "normal", 6000);
check("raising one pair leaves siblings alone", m.hiScores[hiScoreKey("Spread", "normal")] === 7000 && m.hiScores[hiScoreKey("Focus", "normal")] === 6000);

console.log(failures === 0 ? "\n✓ PASS — hi-score writer keeps per-pair maxima\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
