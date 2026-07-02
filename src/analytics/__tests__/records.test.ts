import { describe, it, expect } from "vitest";
import { computeRecordHistory, toChronological } from "../records";
import type { TimedSolve } from "../records";
import type { Penalty } from "../types";

// Helper: id + millis + chronological position (ms) + optional penalty.
const t = (id: string, millis: number, at: number, penalty: Penalty = null): TimedSolve => ({
  id,
  millis,
  penalty,
  localCreatedAt: at,
});

describe("computeRecordHistory", () => {
  it("returns no records and empty history for no solves", () => {
    const { currentRecords, history } = computeRecordHistory([]);
    expect(currentRecords).toEqual({ single: null, ao5: null, ao12: null, ao50: null, ao100: null });
    expect(history).toEqual([]);
  });

  it("tolerates non-array input", () => {
    // @ts-expect-error exercising defensive guard against bad runtime input
    const result = computeRecordHistory(null);
    expect(result.history).toEqual([]);
  });

  it("the first valid solve sets the Single record with no previous value", () => {
    const { currentRecords, history } = computeRecordHistory([t("a", 12000, 1)]);
    expect(currentRecords.single).toEqual({ valueMs: 12000, solveId: "a", timestamp: 1 });
    expect(history).toEqual([
      { recordType: "single", valueMs: 12000, solveId: "a", timestamp: 1, previousValueMs: null },
    ]);
  });

  it("a faster solve later sets a new Single record referencing the old value", () => {
    const solves = [t("a", 12000, 1), t("b", 15000, 2), t("c", 9000, 3)];
    const { currentRecords, history } = computeRecordHistory(solves);

    expect(currentRecords.single).toEqual({ valueMs: 9000, solveId: "c", timestamp: 3 });
    expect(history.map((h) => h.recordType)).toEqual(["single", "single"]);
    expect(history[1]).toEqual({
      recordType: "single",
      valueMs: 9000,
      solveId: "c",
      timestamp: 3,
      previousValueMs: 12000,
    });
  });

  it("does not record a PB for a slower or exactly tied solve (duplicate prevention)", () => {
    const solves = [t("a", 10000, 1), t("b", 12000, 2), t("c", 10000, 3)];
    const { history } = computeRecordHistory(solves);

    // Only "a" sets a record; "b" is slower, "c" ties the existing record exactly.
    expect(history).toHaveLength(1);
    expect(history[0].solveId).toBe("a");
  });

  it("does not count DNF solves toward the Single record", () => {
    const solves = [t("a", 9000, 1, "DNF"), t("b", 11000, 2)];
    const { currentRecords, history } = computeRecordHistory(solves);

    expect(currentRecords.single).toEqual({ valueMs: 11000, solveId: "b", timestamp: 2 });
    expect(history).toHaveLength(1);
    expect(history[0].solveId).toBe("b");
  });

  it("applies the +2 penalty when comparing single times", () => {
    // 9000+2000=11000 is not actually faster than 10000, so no new record.
    const solves = [t("a", 10000, 1), t("b", 9000, 2, "+2")];
    const { currentRecords } = computeRecordHistory(solves);
    expect(currentRecords.single).toEqual({ valueMs: 10000, solveId: "a", timestamp: 1 });
  });

  it("detects an ao5 record only once 5 solves exist, attributed to the 5th solve", () => {
    const solves = [
      t("a", 10000, 1),
      t("b", 10000, 2),
      t("c", 10000, 3),
      t("d", 10000, 4),
      t("e", 10000, 5),
    ];
    const { currentRecords, history } = computeRecordHistory(solves);

    expect(currentRecords.ao5).toEqual({ valueMs: 10000, solveId: "e", timestamp: 5 });
    const ao5Events = history.filter((h) => h.recordType === "ao5");
    expect(ao5Events).toHaveLength(1);
    expect(ao5Events[0].solveId).toBe("e");
  });

  it("a single solve can set multiple record types at once", () => {
    // 8 mediocre solves (ao5 record locks in at 20000 by solve 5, single
    // record locks in at 20000 by solve 1), then two fast solves in a row.
    // The 10th solve is both a new Single PB (4000 < 5000) and drags its
    // trailing ao5 window below the standing ao5 record — a single outlier
    // can't do that alone (it gets trimmed), but two consecutive fast solves
    // can, and both land on the same, most recent solve.
    const solves = [
      t("a", 20000, 1),
      t("b", 20000, 2),
      t("c", 20000, 3),
      t("d", 20000, 4),
      t("e", 20000, 5),
      t("f", 20000, 6),
      t("g", 20000, 7),
      t("h", 20000, 8),
      t("i", 5000, 9),
      t("j", 4000, 10),
    ];
    const { history } = computeRecordHistory(solves);
    const typesForJ = history.filter((h) => h.solveId === "j").map((h) => h.recordType);
    expect(typesForJ).toEqual(expect.arrayContaining(["single", "ao5"]));
  });

  it("keeps history in chronological order (oldest first)", () => {
    const solves = [t("a", 12000, 1), t("b", 9000, 2), t("c", 5000, 3)];
    const { history } = computeRecordHistory(solves);
    const timestamps = history.map((h) => h.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((x, y) => x - y));
  });

  it("is deterministic: recomputing from the same input yields identical results", () => {
    const solves = [t("a", 12000, 1), t("b", 9000, 2), t("c", 15000, 3), t("d", 4000, 4)];
    const first = computeRecordHistory(solves);
    const second = computeRecordHistory(solves);
    expect(second).toEqual(first);
  });

  it("removing a solve (simulating deletion) reverts the record to the prior best", () => {
    const withThree = [t("a", 12000, 1), t("b", 9000, 2), t("c", 5000, 3)];
    const beforeDelete = computeRecordHistory(withThree);
    expect(beforeDelete.currentRecords.single?.solveId).toBe("c");

    // "c" (the current record holder) is deleted.
    const afterDelete = computeRecordHistory([t("a", 12000, 1), t("b", 9000, 2)]);
    expect(afterDelete.currentRecords.single).toEqual({ valueMs: 9000, solveId: "b", timestamp: 2 });
  });

  it("marking the record-holding solve DNF reverts the record (simulating a penalty edit)", () => {
    const before = computeRecordHistory([t("a", 12000, 1), t("b", 9000, 2)]);
    expect(before.currentRecords.single?.solveId).toBe("b");

    const after = computeRecordHistory([t("a", 12000, 1), t("b", 9000, 2, "DNF")]);
    expect(after.currentRecords.single).toEqual({ valueMs: 12000, solveId: "a", timestamp: 1 });
  });
});

describe("toChronological", () => {
  it("sorts solves into ascending timestamp order regardless of input order", () => {
    const solves = [t("c", 1, 30), t("a", 1, 10), t("b", 1, 20)];
    const sorted = toChronological(solves);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const solves = [t("b", 1, 20), t("a", 1, 10)];
    const original = [...solves];
    toChronological(solves);
    expect(solves).toEqual(original);
  });
});
