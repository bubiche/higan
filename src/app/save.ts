// Persistence — a single versioned localStorage document.
//
// Everything here is presentation/meta: settings, hi-scores, and unlocks. NONE of
// it enters the simulation or its hash (the sim is the source of truth; the save is
// a durable projection of post-run reads). Loading is defensive: a corrupt, absent,
// or future-versioned document never crashes — it falls back to (or merges over)
// the defaults, so a bad write can't brick the game.

const SAVE_KEY = "higan.save.v1";
const SAVE_VERSION = 1;

// Display-scale bounds, shared by the shell (canvas sizing) and the options screen
// (slider range). A saved value outside this — or a corrupt one — clamps back, so a
// bad save can never produce a zero-size or absurd canvas.
export const MIN_DISPLAY_SCALE = 1.0;
export const MAX_DISPLAY_SCALE = 2.5;
export const DEFAULT_DISPLAY_SCALE = 1.6;
export const clampDisplayScale = (s: number): number =>
  Number.isFinite(s) ? Math.max(MIN_DISPLAY_SCALE, Math.min(MAX_DISPLAY_SCALE, s)) : DEFAULT_DISPLAY_SCALE;

export interface SaveSettings {
  /** Music volume, 0..1. No audio consumer yet (arrives with the audio engine); the
   *  value is persisted now so the control is real and forward-compatible. */
  bgmVolume: number;
  /** SFX volume, 0..1. Same: persisted now, consumed later. */
  sfxVolume: number;
  /** Action → KeyboardEvent.code. The forward slot for key rebinding; the keyboard
   *  source currently uses fixed bindings, so this is schema-only for now (here so a
   *  later rebind UI needs no save-version bump). */
  keybinds: Record<string, string>;
  /** Playfield CSS scale multiplier — applied live by the shell. */
  displayScale: number;
}

export interface SaveData {
  version: number;
  /** Hi-score per character×difficulty key. No score system yet (no writer until
   *  scoring lands); the slot exists so run-end can project into it later. */
  hiScores: Record<string, number>;
  settings: SaveSettings;
  /** Progression flags — none earned yet; the slot exists for later content. */
  unlocks: {
    extra: boolean;
    practiceStages: number[];
    musicRoom: string[];
    spellHistory: Record<string, { seen: number; captured: number }>;
  };
}

export const DEFAULT_SAVE: SaveData = {
  version: SAVE_VERSION,
  hiScores: {},
  settings: {
    bgmVolume: 0.8,
    sfxVolume: 0.8,
    keybinds: {
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      shoot: "KeyZ",
      focus: "ShiftLeft",
      bomb: "KeyX",
    },
    displayScale: DEFAULT_DISPLAY_SCALE,
  },
  unlocks: { extra: false, practiceStages: [], musicRoom: [], spellHistory: {} },
};

/** Deep-clone the defaults so a returned save can be mutated without touching them. */
function freshDefaults(): SaveData {
  return {
    version: SAVE_VERSION,
    hiScores: {},
    settings: { ...DEFAULT_SAVE.settings, keybinds: { ...DEFAULT_SAVE.settings.keybinds } },
    unlocks: { extra: false, practiceStages: [], musicRoom: [], spellHistory: {} },
  };
}

/**
 * Load the save, merging stored fields over the defaults so a missing or
 * future-added field is filled rather than undefined. Any failure (no storage,
 * unparseable JSON, wrong shape) returns clean defaults — never throws.
 */
export function loadSave(): SaveData {
  const base = freshDefaults();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return base; // storage unavailable (private mode, disabled) → defaults
  }
  if (!raw) return base;

  try {
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (!parsed || typeof parsed !== "object") return base;
    // Shallow-merge each section over defaults; a future version with unknown extra
    // fields is kept by spreading, and missing fields keep their default.
    return {
      version: SAVE_VERSION,
      hiScores: { ...base.hiScores, ...(parsed.hiScores ?? {}) },
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      unlocks: { ...base.unlocks, ...(parsed.unlocks ?? {}) },
    };
  } catch {
    return base;
  }
}

/** Persist the save. Swallows storage failures (quota, private mode) — a failed
 *  write must never break gameplay. */
export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable or full — settings just won't persist this session */
  }
}
