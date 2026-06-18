// FNV-1a hash over raw bytes.
//
// Used to fingerprint simulation state so two runs from the same seed + input
// can be checked for bit-identical results (Hard Rule 2 — deterministic sim).
// Hashing the underlying bytes is deliberate: a deterministic run reproduces the
// exact same bit pattern every time (including any consistent -0 or NaN), so a
// byte-level hash trips on *any* divergence. Normalizing the floats would only
// weaken the check.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over the bytes of each Float32Array, in order. Returns an unsigned
 * 32-bit integer. Pass sub-views (`subarray`) to hash only the active prefix.
 */
export function hashFloat32Arrays(arrays: readonly Float32Array[]): number {
  let h = FNV_OFFSET;
  for (const a of arrays) {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, FNV_PRIME);
    }
  }
  return h >>> 0;
}
