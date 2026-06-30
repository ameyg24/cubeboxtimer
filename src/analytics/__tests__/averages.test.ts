import { describe, it, expect } from "vitest";
import {
  ao5,
  ao12,
  averageOfN,
  best,
  bestAverageOfN,
  mean,
  mo3,
  rollingAverageOfN,
  trimCount,
  worst,
  worstAverageOfN,
} from "../averages";
import type { Solve } from "../types";

// Helpers to build solves concisely. Times are in ms.
const s = (millis: number): Solve => ({ millis, penalty: null });
const plus2 = (millis: number): Solve => ({ millis, penalty: "+2" });
const dnf = (): Solve => ({ millis: 0, penalty: "DNF" });

describe("trimCount (WCA 5% rule)", () => {
  it("trims 1 for ao5 and ao12, 3 for ao50, 5 for ao100", () => {
    expect(trimCount(5)).toBe(1);
    expect(trimCount(12)).toBe(1);
    expect(trimCount(50)).toBe(3);
    expect(trimCount(100)).toBe(5);
  });
});

describe("ao5 — normal solves", () => {
  it("drops best and worst, averages the middle three", () => {
    // times: 1,2,3,4,5 (s) -> drop 1 and 5 -> mean(2,3,4) = 3s = 3000ms
    const solves = [s(1000), s(2000), s(3000), s(4000), s(5000)];
    expect(ao5(solves)).toEqual({ status: "ok", valueMs: 3000 });
  });

  it("uses only the last 5 when more are supplied", () => {
    const solves = [s(99000), s(1000), s(2000), s(3000), s(4000), s(5000)];
    expect(ao5(solves)).toEqual({ status: "ok", valueMs: 3000 });
  });
});

describe("+2 penalty", () => {
  it("adds 2000ms to the solve's effective time", () => {
    // 3000+2 -> 5000 becomes the worst and is trimmed
    const solves = [s(1000), s(2000), s(3000), s(4000), plus2(3000)];
    // effective: 1000,2000,3000,4000,5000 -> drop 1000 & 5000 -> mean(2000,3000,4000)=3000
    expect(ao5(solves)).toEqual({ status: "ok", valueMs: 3000 });
  });

  it("affects single best/worst", () => {
    const solves = [s(2000), plus2(1000)]; // effective 2000, 3000
    expect(best(solves)).toEqual({ status: "ok", valueMs: 2000 });
    expect(worst(solves)).toEqual({ status: "ok", valueMs: 3000 });
  });
});

describe("ao5 — exactly one DNF (WCA: DNF is the worst, trimmed once)", () => {
  it("trims the DNF and the single fastest, averages the remaining three", () => {
    // valid 1,2,3,4 (s) + 1 DNF. DNF is worst (trimmed), 1s is best (trimmed)
    // -> mean(2,3,4) = 3s = 3000ms. (Regression guard: old code averaged only 2.)
    const solves = [s(1000), s(2000), s(3000), s(4000), dnf()];
    expect(ao5(solves)).toEqual({ status: "ok", valueMs: 3000 });
  });
});

describe("ao5 — two or more DNFs", () => {
  it("returns dnf with exactly two DNFs", () => {
    const solves = [s(1000), s(2000), s(3000), dnf(), dnf()];
    expect(ao5(solves)).toEqual({ status: "dnf" });
  });

  it("returns dnf when all five are DNF", () => {
    const solves = [dnf(), dnf(), dnf(), dnf(), dnf()];
    expect(ao5(solves)).toEqual({ status: "dnf" });
  });
});

describe("ao5 — insufficient solves", () => {
  it("returns insufficient with fewer than five solves", () => {
    expect(ao5([s(1000), s(2000), s(3000), s(4000)])).toEqual({
      status: "insufficient",
    });
    expect(ao5([])).toEqual({ status: "insufficient" });
  });
});

describe("ao12", () => {
  it("drops best and worst, averages the middle ten", () => {
    // 1..12 s -> drop 1 and 12 -> mean(2..11) = 6.5s = 6500ms
    const solves = Array.from({ length: 12 }, (_, i) => s((i + 1) * 1000));
    expect(ao12(solves)).toEqual({ status: "ok", valueMs: 6500 });
  });

  it("one DNF is trimmed as the worst", () => {
    // 1..11 s valid + 1 DNF -> drop DNF (worst) and 1s (best) -> mean(2..11)=6.5s
    const solves = [
      ...Array.from({ length: 11 }, (_, i) => s((i + 1) * 1000)),
      dnf(),
    ];
    expect(ao12(solves)).toEqual({ status: "ok", valueMs: 6500 });
  });

  it("two DNFs -> dnf", () => {
    const solves = [
      ...Array.from({ length: 10 }, (_, i) => s((i + 1) * 1000)),
      dnf(),
      dnf(),
    ];
    expect(ao12(solves)).toEqual({ status: "dnf" });
  });
});

describe("averageOfN — generic WCA trim for larger n", () => {
  it("ao50 trims 3 from each end", () => {
    // 1..50 s. trim 3 each end -> mean(4..47) = (4+47)/2 = 25.5s = 25500ms
    const solves = Array.from({ length: 50 }, (_, i) => s((i + 1) * 1000));
    expect(averageOfN(solves, 50)).toEqual({ status: "ok", valueMs: 25500 });
  });

  it("ao50 tolerates up to 3 DNFs", () => {
    const base = Array.from({ length: 47 }, (_, i) => s((i + 1) * 1000));
    expect(averageOfN([...base, dnf(), dnf(), dnf()], 50).status).toBe("ok");
    expect(averageOfN([...base.slice(0, 46), dnf(), dnf(), dnf(), dnf()], 50)).toEqual(
      { status: "dnf" }
    );
  });
});

describe("mo3 — arithmetic mean of three (NOT median)", () => {
  it("averages all three solves without trimming", () => {
    // mean(1,2,9) = 4s = 4000ms (median would be 2s — regression guard)
    expect(mo3([s(1000), s(2000), s(9000)])).toEqual({
      status: "ok",
      valueMs: 4000,
    });
  });

  it("any DNF makes mo3 a dnf", () => {
    expect(mo3([s(1000), s(2000), dnf()])).toEqual({ status: "dnf" });
  });

  it("fewer than three solves is insufficient", () => {
    expect(mo3([s(1000), s(2000)])).toEqual({ status: "insufficient" });
  });

  it("uses the last three when more are supplied", () => {
    expect(mo3([s(99000), s(1000), s(2000), s(9000)])).toEqual({
      status: "ok",
      valueMs: 4000,
    });
  });
});

describe("mean / best / worst over valid solves", () => {
  it("mean ignores DNFs and applies +2", () => {
    // valid: 2000, 3000(+2 from 1000) -> mean 2500
    expect(mean([s(2000), plus2(1000), dnf()])).toEqual({
      status: "ok",
      valueMs: 2500,
    });
  });

  it("all-DNF mean/best/worst are insufficient (no valid times)", () => {
    const solves = [dnf(), dnf(), dnf()];
    expect(mean(solves)).toEqual({ status: "insufficient" });
    expect(best(solves)).toEqual({ status: "insufficient" });
    expect(worst(solves)).toEqual({ status: "insufficient" });
  });

  it("empty input is insufficient", () => {
    expect(mean([])).toEqual({ status: "insufficient" });
    expect(best([])).toEqual({ status: "insufficient" });
  });
});

describe("rolling / best / worst average windows", () => {
  it("rollingAverageOfN aligns to indices and fills early positions", () => {
    const solves = [s(1000), s(2000), s(3000), s(4000), s(5000), s(6000)];
    const rolling = rollingAverageOfN(solves, 5);
    expect(rolling).toHaveLength(6);
    expect(rolling[3]).toEqual({ status: "insufficient" });
    expect(rolling[4]).toEqual({ status: "ok", valueMs: 3000 }); // mean(2,3,4)
    expect(rolling[5]).toEqual({ status: "ok", valueMs: 4000 }); // mean(3,4,5)
  });

  it("bestAverageOfN / worstAverageOfN pick the extreme window", () => {
    const solves = [s(1000), s(2000), s(3000), s(4000), s(5000), s(6000)];
    expect(bestAverageOfN(solves, 5)).toEqual({ status: "ok", valueMs: 3000 });
    expect(worstAverageOfN(solves, 5)).toEqual({ status: "ok", valueMs: 4000 });
  });

  it("best/worst average return insufficient when no full window exists", () => {
    expect(bestAverageOfN([s(1000)], 5)).toEqual({ status: "insufficient" });
  });
});
