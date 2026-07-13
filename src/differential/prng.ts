// Deterministic PRNG for the differential harness. mulberry32: tiny,
// well-distributed for this purpose, and fully reproducible from one
// 32-bit seed. Nothing in this directory may call Math.random or read a
// clock; every random decision flows through one of these helpers so a
// failing test is replayable from its seed alone.

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], both inclusive. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randomInt(rng, 0, items.length - 1)];
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
