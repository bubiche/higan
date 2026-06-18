// Playfield dimensions, in sim units. The Touhou convention is a 4:3-ish
// portrait field; everything in the simulation is measured against these.
export const PLAYFIELD_W = 384;
export const PLAYFIELD_H = 448;

/** Fixed simulation timestep, in seconds. The sim always advances by exactly this. */
export const DT = 1 / 60;
