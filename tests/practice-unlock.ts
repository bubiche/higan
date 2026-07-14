// Headless proof — the per-stage practice unlock.
//
// The practice menu itself can only be eyeballed in a browser, but the two pure pieces it rests
// on ARE unit-testable here: the writer (`recordPracticeStage` in save.ts — set-membership,
// idempotent, change-signalling) and the query that turns the stored index set into a menu list
// (`practiceableStageIndices` — non-extra ∩ reached, in `stages` order, robust to a shrunk
// roster). The query is replicated here (like the char-select best-scan in hiscore-reader)
// so the test pins the logic without importing the DOM-bound screen module.

import { recordPracticeStage, DEFAULT_SAVE, type SaveData } from "../src/app/save";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${detail}`);
  if (!pass) failures++;
};

const freshSave = (): SaveData => ({
  ...DEFAULT_SAVE,
  unlocks: { ...DEFAULT_SAVE.unlocks, practiceStages: [] },
});

// The screen's query, replicated over a minimal stages-shaped list. The real version reads
// `def.stages`/`save.unlocks`; this is the same shape over a plain array + save.
const practiceableStageIndices = (
  stages: readonly { extra?: boolean }[],
  save: SaveData,
): number[] => {
  const reached = save.unlocks.practiceStages;
  return stages.flatMap((s, i) => (!s.extra && reached.includes(i) ? [i] : []));
};

// ── recordPracticeStage: idempotent set + change signal ───────────────────────
const s = freshSave();
check("a fresh save has no practiceable stages", s.unlocks.practiceStages.length === 0);
check("recording a new stage returns true (newly added)", recordPracticeStage(s, 0) === true);
check("...and the index is now stored", s.unlocks.practiceStages.includes(0));
check("re-recording the same stage returns false (idempotent)", recordPracticeStage(s, 0) === false);
check("...and does not duplicate it", s.unlocks.practiceStages.filter((i) => i === 0).length === 1);
check("recording a second stage returns true", recordPracticeStage(s, 1) === true);
check("both stages are stored", s.unlocks.practiceStages.includes(0) && s.unlocks.practiceStages.includes(1));

// ── practiceableStageIndices: non-extra ∩ reached, def order, stale-proof ──────
const chain = [{}, {}, {}, { extra: true }]; // 3 main stages + 1 extra (indices 0..3)

check("nothing reached → empty list", practiceableStageIndices(chain, freshSave()).length === 0);

const r1 = freshSave();
recordPracticeStage(r1, 0);
check("reaching stage 0 lists exactly [0]", JSON.stringify(practiceableStageIndices(chain, r1)) === "[0]");

// Reached out of order (2 then 0) must still list in DEF order, not reach order.
const r2 = freshSave();
recordPracticeStage(r2, 2);
recordPracticeStage(r2, 0);
check("reached out of order → listed in stages order", JSON.stringify(practiceableStageIndices(chain, r2)) === "[0,2]");

// The extra stage is never listed by practice even if its index somehow got recorded (a
// campaign reach never records it, but the filter must not depend on that).
const r3 = freshSave();
recordPracticeStage(r3, 0);
recordPracticeStage(r3, 1);
recordPracticeStage(r3, 2);
recordPracticeStage(r3, 3); // the extra index
check("all 3 main stages list; the extra index is excluded", JSON.stringify(practiceableStageIndices(chain, r3)) === "[0,1,2]");

// A stale saved index past the end of a (shrunk) stage list is simply not produced.
const r4 = freshSave();
recordPracticeStage(r4, 0);
recordPracticeStage(r4, 9); // no such stage
check("a stale out-of-range index is dropped", JSON.stringify(practiceableStageIndices(chain, r4)) === "[0]");

console.log(failures === 0 ? "\n✓ PASS — practice-stage writer + practiceable-stage query\n" : `\n✗ ${failures} FAILURE(S)\n`);
if (failures > 0) process.exitCode = 1;
