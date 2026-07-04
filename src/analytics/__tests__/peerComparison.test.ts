import { describe, it, expect } from "vitest";
import { predictFromCompetitionHistory } from "../peerComparison";
import type { PeerCompetitionResult } from "../peerComparison";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);

const result = (id: string, daysBeforeBase: number, averageMs: number): PeerCompetitionResult => ({
  id,
  competitionName: `Comp ${id}`,
  date: new Date(BASE - daysBeforeBase * DAY).toISOString(),
  averageMs,
});

describe("predictFromCompetitionHistory", () => {
  it("returns insufficient confidence and no prediction for zero results", () => {
    const p = predictFromCompetitionHistory([], "3x3x3", "2009ZEMD01", "Feliks Zemdegs");
    expect(p.competitionsUsed).toBe(0);
    expect(p.weightedAverageMs).toBeNull();
    expect(p.trendMsPerCompetition).toBeNull();
    expect(p.predictedAverageMs).toBeNull();
    expect(p.confidenceRangeMs).toBeNull();
    expect(p.confidenceLevel).toBe("insufficient");
  });

  it("computes a weighted average but no trend or prediction with exactly one result", () => {
    const history = [result("c1", 30, 10000)];
    const p = predictFromCompetitionHistory(history, "3x3x3", "2009ZEMD01", "Feliks Zemdegs");
    expect(p.weightedAverageMs).toBe(10000);
    expect(p.trendMsPerCompetition).toBeNull();
    expect(p.predictedAverageMs).toBeNull();
    expect(p.confidenceLevel).toBe("low");
  });

  it("weights recent results more heavily than older ones", () => {
    // Two very different results: old=20000ms, recent=10000ms. A plain mean
    // would be 15000; the recency weighting (weights 1,2) should pull it
    // toward the more recent (faster) result instead.
    const history = [result("old", 60, 20000), result("recent", 10, 10000)];
    const p = predictFromCompetitionHistory(history, "3x3x3", "2009ZEMD01", null);
    const plainMean = 15000;
    expect(p.weightedAverageMs).toBeLessThan(plainMean);
    expect(p.weightedAverageMs).toBeCloseTo((20000 * 1 + 10000 * 2) / 3, 5);
  });

  it("detects an improving trend (getting faster) as a negative slope", () => {
    const history = [result("c1", 60, 12000), result("c2", 40, 11000), result("c3", 20, 10000)];
    const p = predictFromCompetitionHistory(history, "3x3x3", "2009ZEMD01", null);
    expect(p.trendMsPerCompetition).toBeCloseTo(-1000, 5);
    // The predicted next result should be faster (lower ms) than the most
    // recent result, since the trend keeps improving.
    expect(p.predictedAverageMs).toBeLessThan(10000);
  });

  it("detects a declining trend (getting slower) as a positive slope", () => {
    const history = [result("c1", 60, 10000), result("c2", 40, 11000), result("c3", 20, 12000)];
    const p = predictFromCompetitionHistory(history, "3x3x3", "2009ZEMD01", null);
    expect(p.trendMsPerCompetition).toBeCloseTo(1000, 5);
    expect(p.predictedAverageMs).toBeGreaterThan(12000);
  });

  it("gives high confidence for many consistent results, low for volatile ones", () => {
    const consistent = [
      result("c1", 100, 10000),
      result("c2", 80, 10100),
      result("c3", 60, 9950),
      result("c4", 40, 10050),
      result("c5", 20, 9900),
    ];
    const volatile = [
      result("c1", 100, 8000),
      result("c2", 80, 15000),
      result("c3", 60, 9000),
      result("c4", 40, 14000),
      result("c5", 20, 8500),
    ];
    const consistentPrediction = predictFromCompetitionHistory(consistent, "3x3x3", "id1", null);
    const volatilePrediction = predictFromCompetitionHistory(volatile, "3x3x3", "id2", null);
    expect(consistentPrediction.confidenceLevel).toBe("high");
    expect(volatilePrediction.confidenceLevel).toBe("low");
  });

  it("preserves the exact history it was given, in order", () => {
    const history = [result("c1", 60, 12000), result("c2", 20, 10000)];
    const p = predictFromCompetitionHistory(history, "3x3x3", "2009ZEMD01", null);
    expect(p.history).toEqual(history);
  });

  it("carries through the WCA ID, person name, and event unchanged", () => {
    const p = predictFromCompetitionHistory(
      [result("c1", 30, 10000), result("c2", 10, 9800)],
      "3x3x3",
      "2009ZEMD01",
      "Feliks Zemdegs"
    );
    expect(p.wcaId).toBe("2009ZEMD01");
    expect(p.personName).toBe("Feliks Zemdegs");
    expect(p.event).toBe("3x3x3");
    expect(p.competitionsUsed).toBe(2);
  });

  it("handles a null person name defensively", () => {
    const p = predictFromCompetitionHistory([result("c1", 30, 10000)], "3x3x3", "2009ZEMD01", null);
    expect(p.personName).toBeNull();
  });

  it("reports totalCompetitionsAvailable alongside competitionsUsed when nothing is windowed out", () => {
    const history = [result("c1", 30, 10000), result("c2", 10, 9800)];
    const p = predictFromCompetitionHistory(history, "3x3x3", "2009ZEMD01", null);
    expect(p.competitionsUsed).toBe(2);
    expect(p.totalCompetitionsAvailable).toBe(2);
  });

  it("caps the estimate to the most recent competitions, ignoring a long tail of much older/slower results", () => {
    // 15 competitions total: the oldest 5 are a beginner's much slower
    // times, the most recent 10 are fast and consistent. With the default
    // 10-competition window, only the recent, consistent block should feed
    // the estimate - the old block shouldn't drag the average down or
    // manufacture variance that crushes confidence.
    const beginnerEra = [
      result("b1", 400, 30000),
      result("b2", 380, 28000),
      result("b3", 360, 26000),
      result("b4", 340, 25000),
      result("b5", 320, 24000),
    ];
    const recentForm = Array.from({ length: 10 }, (_, i) =>
      result(`r${i}`, 100 - i * 10, 10000 + (i % 2 === 0 ? 50 : -50))
    );
    const p = predictFromCompetitionHistory([...beginnerEra, ...recentForm], "3x3x3", "2009ZEMD01", null);

    expect(p.totalCompetitionsAvailable).toBe(15);
    expect(p.competitionsUsed).toBe(10);
    expect(p.history).toEqual(recentForm);
    // Anchored entirely around ~10000ms, nowhere near the beginner-era 24-30s times.
    expect(p.weightedAverageMs).toBeGreaterThan(9000);
    expect(p.weightedAverageMs).toBeLessThan(11000);
    expect(p.confidenceLevel).toBe("high");
  });

  it("supports a custom window size", () => {
    const history = [
      result("c1", 100, 20000),
      result("c2", 80, 20000),
      result("c3", 60, 10000),
      result("c4", 40, 10000),
      result("c5", 20, 10000),
    ];
    const p = predictFromCompetitionHistory(history, "3x3x3", "2009ZEMD01", null, 3);
    expect(p.competitionsUsed).toBe(3);
    expect(p.totalCompetitionsAvailable).toBe(5);
    expect(p.history).toEqual(history.slice(-3));
  });
});
