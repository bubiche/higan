// Funnel for the transcendentals sim-hashed code uses (`sin`/`cos`/`atan2`). IEEE 754
// mandates `+ - * /` and `sqrt` be correctly-rounded, so those are already bit-identical
// across engines/hardware — but `sin`/`cos`/`atan2` aren't, which is why replaying a
// recording on a different machine/browser than recorded it isn't guaranteed to match.
// Routing every sim call through here — instead of `Math.sin`/`Math.cos`/`Math.atan2` ad
// hoc — keeps a future bit-identical replacement (table-based or fixed-point) a one-file
// swap instead of a hunt across the sim. These are plain aliases today: byte-identical to
// `Math.*`, so this file is baseline-neutral.
export const sin = Math.sin;
export const cos = Math.cos;
export const atan2 = Math.atan2;
