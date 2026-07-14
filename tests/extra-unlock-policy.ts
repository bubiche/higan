// Unit test — the Extra-unlock policy predicate.
//
// `evaluateExtraUnlock` is the pure, DOM-free half of the Extra-stage unlock (the results
// screen calls it in `enter()` and writes `save.unlocks.extra`, but that write is DOM-bound
// and not headlessly testable — like `recordHiScore`). This exercises every branch of the
// two built-in policies plus the undefined-defaults-to-any-clear path, so the WRITER is
// proven correct even though the demo ships "any-clear" and never exercises the strict mode
// live. (Without a visible reader for the unlock, this unit test + inspecting localStorage
// after a clear is the verification of the write, not a live-check.)

import { evaluateExtraUnlock, DEFAULT_RUN_CONFIG } from "../src/api/config";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(66)} ${detail}`);
  if (!pass) failures++;
};

console.log(`\n⟐ Extra-unlock policy predicate\n`);

// ── The default ──────────────────────────────────────────────────────────────────
check('DEFAULT_RUN_CONFIG ships "any-clear"', DEFAULT_RUN_CONFIG.extraUnlock === "any-clear", `${DEFAULT_RUN_CONFIG.extraUnlock}`);

// ── A non-clear NEVER unlocks (total, regardless of policy) ─────────────────────────
check('"any-clear": game-over does not unlock', evaluateExtraUnlock("any-clear", { cleared: false, continuesUsed: 0, difficulty: 3 }) === false);
check('"no-continue-normal-plus": game-over does not unlock', evaluateExtraUnlock("no-continue-normal-plus", { cleared: false, continuesUsed: 0, difficulty: 3 }) === false);
check("undefined policy: game-over does not unlock", evaluateExtraUnlock(undefined, { cleared: false, continuesUsed: 0, difficulty: 3 }) === false);

// ── "any-clear" — any clear unlocks, whatever the continues/rank ───────────────────
check('"any-clear": clear on Easy, continued → UNLOCK', evaluateExtraUnlock("any-clear", { cleared: true, continuesUsed: 2, difficulty: 0 }) === true);
check('"any-clear": clear on Lunatic, no continue → UNLOCK', evaluateExtraUnlock("any-clear", { cleared: true, continuesUsed: 0, difficulty: 3 }) === true);

// ── undefined defaults to "any-clear" ──────────────────────────────────────────────
check("undefined policy: any clear → UNLOCK (defaults to any-clear)", evaluateExtraUnlock(undefined, { cleared: true, continuesUsed: 5, difficulty: 0 }) === true);

// ── "no-continue-normal-plus" — no continue AND rank ≥ 1 (above the easiest) ────────
check('strict: clear, 0 continues, Normal (idx 1) → UNLOCK', evaluateExtraUnlock("no-continue-normal-plus", { cleared: true, continuesUsed: 0, difficulty: 1 }) === true);
check('strict: clear, 0 continues, Hard (idx 2) → UNLOCK', evaluateExtraUnlock("no-continue-normal-plus", { cleared: true, continuesUsed: 0, difficulty: 2 }) === true);
check('strict: clear, 0 continues, Lunatic (idx 3) → UNLOCK', evaluateExtraUnlock("no-continue-normal-plus", { cleared: true, continuesUsed: 0, difficulty: 3 }) === true);
check('strict: clear, 0 continues, Easy (idx 0) → NO unlock', evaluateExtraUnlock("no-continue-normal-plus", { cleared: true, continuesUsed: 0, difficulty: 0 }) === false);
check('strict: clear, 1 continue, Normal → NO unlock', evaluateExtraUnlock("no-continue-normal-plus", { cleared: true, continuesUsed: 1, difficulty: 1 }) === false);
check('strict: clear, 3 continues, Lunatic → NO unlock', evaluateExtraUnlock("no-continue-normal-plus", { cleared: true, continuesUsed: 3, difficulty: 3 }) === false);

console.log(failures === 0 ? `\n✓ extra-unlock PASS (${13} checks)\n` : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
