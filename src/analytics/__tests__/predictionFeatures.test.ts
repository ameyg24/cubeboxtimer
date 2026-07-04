import { describe, it, expect } from "vitest";
import { buildFeatureVector } from "../predictionFeatures";
import type { CompetitionResultInput, TimedPracticeSolve } from "../competitionPrediction";
import type { Penalty } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);

const solveAt = (daysBeforeBase: number, millis: number, penalty: Penalty = null): TimedPracticeSolve => ({
  millis,
  penalty,
  localCreatedAt: BASE - daysBeforeBase * DAY,
});

const competition = (id: string, daysBeforeBase: number, averageMs: number | null): CompetitionResultInput => ({
  id,
  date: new Date(BASE - daysBeforeBase * DAY).toISOString(),
  event: "3x3x3",
  averageMs,
});

describe("buildFeatureVector", () => {
  it("computes practice stats from the window before referenceDateMs", () => {
    const solves = [solveAt(10, 10000), solveAt(8, 10200), solveAt(6, 9800)];
    const features = buildFeatureVector(solves, "3x3x3", BASE, [], 14);
    expect(features.practiceCount).toBe(3);
    expect(features.practiceMeanMs).toBeCloseTo((10000 + 10200 + 9800) / 3, 5);
    expect(features.practiceBestMs).toBe(9800);
    expect(features.practiceStddevMs).not.toBeNull();
  });

  it("never leaks solves or competitions dated on/after referenceDateMs", () => {
    const solves = [solveAt(10, 10000), solveAt(-1, 999999)]; // one solve "in the future"
    const priors = [competition("future", -5, 5000)]; // a competition "in the future"
    const features = buildFeatureVector(solves, "3x3x3", BASE, priors, 14);
    expect(features.practiceMeanMs).toBe(10000);
    expect(features.practiceCount).toBe(1);
    expect(features.priorCompetitionCount).toBe(0);
    expect(features.daysSincePreviousCompetition).toBeNull();
  });

  it("filters out prior results at exactly referenceDateMs, not just strictly after", () => {
    const priors = [competition("same-day", 0, 10500)];
    const features = buildFeatureVector([], "3x3x3", BASE, priors, 14);
    expect(features.priorCompetitionCount).toBe(0);
  });

  it("reports null practice fields with no practice data, but well-defined rate/count fields", () => {
    const features = buildFeatureVector([], "3x3x3", BASE, [], 14);
    expect(features.practiceMeanMs).toBeNull();
    expect(features.practiceAo5Ms).toBeNull();
    expect(features.practiceStddevMs).toBeNull();
    expect(features.practiceBestMs).toBeNull();
    expect(features.dnfRatePct).toBe(0);
    expect(features.plus2RatePct).toBe(0);
    expect(features.practiceCount).toBe(0);
  });

  it("computes a 100% DNF rate and null practiceMeanMs for an all-DNF window", () => {
    const solves = [solveAt(5, 0, "DNF"), solveAt(3, 0, "DNF")];
    const features = buildFeatureVector(solves, "3x3x3", BASE, [], 14);
    expect(features.dnfRatePct).toBe(100);
    expect(features.practiceMeanMs).toBeNull();
    expect(features.practiceCount).toBe(2);
  });

  it("computes a +2 rate and still includes +2 solves in the mean (with the penalty applied)", () => {
    const solves = [solveAt(5, 10000, "+2"), solveAt(3, 9000)];
    const features = buildFeatureVector(solves, "3x3x3", BASE, [], 14);
    expect(features.plus2RatePct).toBe(50);
    expect(features.practiceMeanMs).toBeCloseTo((12000 + 9000) / 2, 5);
  });

  it("computes daysSincePreviousCompetition from the most recent prior competition", () => {
    const priors = [competition("c1", 30, 11000), competition("c2", 10, 10800)];
    const features = buildFeatureVector([], "3x3x3", BASE, priors, 14);
    expect(features.daysSincePreviousCompetition).toBeCloseTo(10, 5);
    expect(features.priorCompetitionCount).toBe(2);
  });

  it("computes averageCompetitionGapDays only with 2+ prior competitions", () => {
    const onePrior = buildFeatureVector([], "3x3x3", BASE, [competition("c1", 10, 11000)], 14);
    expect(onePrior.averageCompetitionGapDays).toBeNull();

    const threePriors = [competition("c1", 40, 11000), competition("c2", 25, 10900), competition("c3", 10, 10800)];
    const features = buildFeatureVector([], "3x3x3", BASE, threePriors, 14);
    expect(features.averageCompetitionGapDays).toBeCloseTo(15, 5); // (40-25) and (25-10), mean 15
  });

  it("sorts unsorted prior results before computing gap/recency features", () => {
    const shuffled = [competition("c2", 10, 10800), competition("c1", 40, 11000), competition("c3", 25, 10900)];
    const features = buildFeatureVector([], "3x3x3", BASE, shuffled, 14);
    expect(features.daysSincePreviousCompetition).toBeCloseTo(10, 5);
    expect(features.averageCompetitionGapDays).toBeCloseTo(15, 5);
  });

  it("leaves priorPredictionErrorMs null with fewer than 2 prior competitions", () => {
    const features = buildFeatureVector([], "3x3x3", BASE, [competition("c1", 10, 11000)], 14);
    expect(features.priorPredictionErrorMs).toBeNull();
  });

  it("populates priorPredictionErrorMs from the rule-based model's most recent scorable prior competition", () => {
    const solves = [
      solveAt(58, 10000), solveAt(54, 10000), // window before c1 (50 days back)
      solveAt(28, 10000), solveAt(24, 10000), // window before c2 (20 days back)
    ];
    const priors = [competition("c1", 50, 11000), competition("c2", 20, 10500)];
    const features = buildFeatureVector(solves, "3x3x3", BASE, priors, 14);
    // c2 is scored using only c1 as history: predicted = 10000 * 1.10 = 11000; actual 10500 -> |error| = 500
    expect(features.priorPredictionErrorMs).toBeCloseTo(500, 5);
  });

  it("leaves priorPredictionErrorMs null when no practice data existed at the time of any prior competition", () => {
    const priors = [competition("c1", 50, 11000), competition("c2", 20, 10500)];
    const features = buildFeatureVector([], "3x3x3", BASE, priors, 14);
    expect(features.priorPredictionErrorMs).toBeNull();
  });
});
