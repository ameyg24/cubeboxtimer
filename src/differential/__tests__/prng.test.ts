import { describe, it, expect } from "vitest";
import { createRng, randomInt, pick, chance } from "../prng";

describe("createRng", () => {
  it("is deterministic: the same seed yields the same sequence", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds yield different sequences", () => {
    const a = Array.from({ length: 20 }, createRng(1));
    const b = Array.from({ length: 20 }, createRng(2));
    expect(a).not.toEqual(b);
  });

  it("emits values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("helpers", () => {
  it("randomInt stays within inclusive bounds and covers them", () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(rng, 1, 4);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("pick returns only members of the array", () => {
    const rng = createRng(5);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 300; i++) expect(items).toContain(pick(rng, items));
  });

  it("chance is deterministic per seed", () => {
    const a = createRng(9);
    const b = createRng(9);
    for (let i = 0; i < 100; i++) expect(chance(a, 0.3)).toBe(chance(b, 0.3));
  });
});
