import { describe, it, expect } from "vitest";
import { computeSessionStats } from "../sessionStats";
import type { Solve } from "../types";

const s = (millis: number): Solve => ({ millis, penalty: null });
const plus2 = (millis: number): Solve => ({ millis, penalty: "+2" });
const dnf = (): Solve => ({ millis: 0, penalty: "DNF" });

describe("computeSessionStats", () => {
  it("returns insufficient/empty fields for no solves", () => {
    const stats = computeSessionStats([]);
    expect(stats.count).toBe(0);
    expect(stats.validCount).toBe(0);
    expect(stats.best).toEqual({ status: "insufficient" });
    expect(stats.mean).toEqual({ status: "insufficient" });
    expect(stats.ao5).toEqual({ status: "insufficient" });
    expect(stats.stddevMs).toBeNull();
    expect(stats.totalTimeMs).toBe(0);
    expect(stats.bestStreak).toBe(0);
  });

  it("counts DNFs and +2s and applies +2 to aggregates", () => {
    const solves = [s(2000), plus2(1000), dnf()];
    const stats = computeSessionStats(solves);
    expect(stats.count).toBe(3);
    expect(stats.validCount).toBe(2);
    expect(stats.dnfCount).toBe(1);
    expect(stats.plus2Count).toBe(1);
    expect(stats.best).toEqual({ status: "ok", valueMs: 2000 });
    expect(stats.worst).toEqual({ status: "ok", valueMs: 3000 }); // 1000 + 2000
    expect(stats.mean).toEqual({ status: "ok", valueMs: 2500 });
    expect(stats.totalTimeMs).toBe(5000);
  });

  it("computes ao5 and a single-DNF ao5 correctly", () => {
    const solves = [s(1000), s(2000), s(3000), s(4000), dnf()];
    const stats = computeSessionStats(solves);
    expect(stats.ao5).toEqual({ status: "ok", valueMs: 3000 });
    expect(stats.dnfCount).toBe(1);
  });

  it("all-DNF session: averages are dnf, scalars insufficient", () => {
    const solves = [dnf(), dnf(), dnf(), dnf(), dnf()];
    const stats = computeSessionStats(solves);
    expect(stats.validCount).toBe(0);
    expect(stats.best).toEqual({ status: "insufficient" });
    expect(stats.mean).toEqual({ status: "insufficient" });
    expect(stats.ao5).toEqual({ status: "dnf" });
    expect(stats.bestStreak).toBe(0);
  });

  it("bestStreak counts consecutive valid solves under the mean", () => {
    // times: 1,1,10,1 (s). mean = 3.25s. Streaks of <mean: [1,1] then [1] -> best 2
    const solves = [s(1000), s(1000), s(10000), s(1000)];
    const stats = computeSessionStats(solves);
    expect(stats.bestStreak).toBe(2);
  });

  it("stddev is zero when all valid times are equal", () => {
    const stats = computeSessionStats([s(3000), s(3000), s(3000)]);
    expect(stats.stddevMs).toBe(0);
    expect(stats.mo3).toEqual({ status: "ok", valueMs: 3000 });
  });

  it("tolerates non-array input", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    const stats = computeSessionStats(null);
    expect(stats.count).toBe(0);
  });
});
