// Music room screen.
//
// Reached from the title menu. Lists the BGM tracks the player has HEARD (unlocked on
// first play — see runGame's onTrackStart wiring) and plays the highlighted one using the
// same BGM player as gameplay (full intro→loop, crossfaded). Pure presentation: it reads
// the save's unlock list and drives `shell.audio`; it never touches the sim or its hash.
//
// Tracks are listed in MANIFEST declaration order (filtered to the unlocked set), not
// unlock order, so the ordering is stable and stale ids from an old save (a track since
// removed) are dropped for free.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";

// Debounce highlight→playBgm: holding ↓ scrolls faster than the ~0.35s crossfade, and the
// two-channel player would overlap tracks if switched every move. Waiting for the cursor
// to settle both fixes that and feels better — the track under the cursor plays once you
// stop on it.
const HIGHLIGHT_DELAY_MS = 130;

export function createMusicRoomScreen(shell: Shell): Screen {
  const { overlay, input } = shell;
  const bgm = shell.def.assets?.audio?.bgm ?? {};
  const unlocked = shell.save.unlocks.musicRoom;
  // Manifest order, filtered to what's been heard.
  const tracks = Object.values(bgm).filter((t) => unlocked.includes(t.id));
  const trackIds = tracks.map((t) => t.id);

  let menu: Menu;
  // Pending debounced play; cleared on each highlight change and on exit.
  let pending: number | undefined;
  const clearPending = (): void => {
    if (pending !== undefined) {
      window.clearTimeout(pending);
      pending = undefined;
    }
  };

  return {
    enter(): void {
      input.flush();
      menu = createMenu(overlay, {
        title: "MUSIC ROOM",
        hint: tracks.length
          ? "↑/↓ select · Z play · X back"
          : "Play through the game to unlock tracks · X back",
        onCancel: () => shell.router.pop(),
        onSfx: (id) => shell.audio.play(id),
        // Play the highlighted track once the cursor settles. The Back row (index past the
        // tracks) plays nothing — it just clears any pending switch, leaving the current
        // track playing while you decide.
        onHighlight: (i) => {
          clearPending();
          const id = trackIds[i];
          if (id === undefined) return;
          pending = window.setTimeout(() => {
            pending = undefined;
            shell.audio.playBgm(id);
          }, HIGHLIGHT_DELAY_MS);
        },
        items: [
          ...tracks.map((t) => ({
            kind: "action" as const,
            label: t.title,
            // Z = play this now, skipping the debounce (idempotent if already playing).
            onConfirm: (): void => {
              clearPending();
              shell.audio.playBgm(t.id);
            },
          })),
          { kind: "action", label: "Back", onConfirm: (): void => shell.router.pop() },
        ],
      });
    },
    exit(): void {
      clearPending();
      menu.dispose();
      // pop() does NOT re-enter the revealed title screen, so its theme won't re-assert on
      // its own — restore it here (mirrors title.enter). The room is only reached from the
      // title, so returning there is the only exit.
      shell.audio.playBgm(shell.def.assets?.audio?.shell?.title ?? null);
    },
    frame(): void {
      menu.handleEvents(input.takeEvents());
    },
    render(): void {
      // DOM-only; the field stays cleared by the shell.
    },
  };
}
