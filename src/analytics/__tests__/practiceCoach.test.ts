import { describe, it, expect } from "vitest";
import { computePracticeCoachResult, CV_CAP, DNF_RISK_CAP, MOMENTUM_SENSITIVITY, TARGET_SOLVES_14D } from "../practiceCoach";
import type { TrainingSignals } from "../trainingSignals";

const BANNED_WORDS = ["great", "amazing", "significant", "powerful", "intelligent"];

// A "healthy" baseline where no rule fires: consistent, high volume, flat
// momentum, low DNF rate, confident competition read, recent PB.
const baseSignals = (overrides: Partial<TrainingSignals> = {}): TrainingSignals => ({
  event: "3x3x3",
  practiceMeanMs: 10000,
  practiceStddevMs: 500, // cv 0.05, under CV_CAP
  dnfRatePct: 2, // under DNF_RISK_CAP*100
  plus2RatePct: 5,
  practiceCount: 60, // over TARGET_SOLVES_14D
  practiceDaysInLast14: 10,
  momentumMs: -200, // getting faster
  competitionGapPct: 0.02, // under trigger
  competitionConfidence: "high",
  backtestErrorPct: 3,
  daysSinceLastPb: 5, // under stale threshold
  ...overrides,
});

const emptySignals: TrainingSignals = {
  event: "3x3x3",
  practiceMeanMs: null,
  practiceStddevMs: null,
  dnfRatePct: 0,
  plus2RatePct: 0,
  practiceCount: 0,
  practiceDaysInLast14: 0,
  momentumMs: null,
  competitionGapPct: null,
  competitionConfidence: "insufficient",
  backtestErrorPct: null,
  daysSinceLastPb: null,
};

function focusIds(result: ReturnType<typeof computePracticeCoachResult>) {
  return result.focusAreas.map((f) => f.id);
}

describe("computePracticeCoachResult", () => {
  it("produces a ready, no-focus-area result for a healthy baseline", () => {
    const result = computePracticeCoachResult(baseSignals());
    expect(result.readiness.label).toBe("ready");
    expect(result.focusAreas).toEqual([]);
    expect(result.limitations).toEqual([]);
    expect(result.confidence).toBe("high");
  });

  it("handles insufficient data without throwing, with a deterministic mixed readiness", () => {
    const result = computePracticeCoachResult(emptySignals);
    // subscores: consistency 0.5 (neutral), volume 0, momentum 0.5 (neutral), dnfRisk 1, competitionConfidence 0
    // average = 2/5 = 0.4 -> score 40 -> "mixed"
    expect(result.readiness.score).toBe(40);
    expect(result.readiness.label).toBe("mixed");
    expect(result.confidence).toBe("low");
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("only flags build-recent-volume when there is no practice at all", () => {
    const result = computePracticeCoachResult(emptySignals);
    expect(focusIds(result)).toEqual(["build-recent-volume"]);
  });

  it("flags clean-up-solves on a high DNF rate", () => {
    const result = computePracticeCoachResult(baseSignals({ dnfRatePct: DNF_RISK_CAP * 100 + 5 }));
    expect(focusIds(result)).toContain("clean-up-solves");
    const area = result.focusAreas.find((f) => f.id === "clean-up-solves")!;
    expect(area.priority).toBe("high");
    expect(area.evidence).toContainEqual({ label: "DNF rate", value: `${(DNF_RISK_CAP * 100 + 5).toFixed(1)}%` });
  });

  it("flags stabilize-execution on high variance", () => {
    const signals = baseSignals({ practiceStddevMs: 10000 * (CV_CAP + 0.05) });
    const result = computePracticeCoachResult(signals);
    expect(focusIds(result)).toContain("stabilize-execution");
    expect(result.focusAreas.find((f) => f.id === "stabilize-execution")!.priority).toBe("medium");
  });

  it("flags build-recent-volume on low practice volume", () => {
    const result = computePracticeCoachResult(baseSignals({ practiceCount: TARGET_SOLVES_14D - 10 }));
    expect(focusIds(result)).toContain("build-recent-volume");
  });

  it("flags stabilize-before-pushing-speed on negative momentum (getting slower)", () => {
    const momentumMs = 10000 * (MOMENTUM_SENSITIVITY + 0.05);
    const result = computePracticeCoachResult(baseSignals({ momentumMs }));
    expect(focusIds(result)).toContain("stabilize-before-pushing-speed");
  });

  it("does not flag momentum when recent practice is faster, even if the delta is large", () => {
    const result = computePracticeCoachResult(baseSignals({ momentumMs: -5000 }));
    expect(focusIds(result)).not.toContain("stabilize-before-pushing-speed");
  });

  it("flags run-competition-simulations on a high competition gap with real confidence", () => {
    const result = computePracticeCoachResult(baseSignals({ competitionGapPct: 0.12, competitionConfidence: "medium" }));
    expect(focusIds(result)).toContain("run-competition-simulations");
  });

  it("does not flag competition simulations when confidence is insufficient, even with a large gap value", () => {
    const result = computePracticeCoachResult(
      baseSignals({ competitionGapPct: 0.5, competitionConfidence: "insufficient" })
    );
    expect(focusIds(result)).not.toContain("run-competition-simulations");
  });

  it("flags reset-training-stimulus on a stale PB", () => {
    const result = computePracticeCoachResult(baseSignals({ daysSinceLastPb: 45 }));
    expect(focusIds(result)).toContain("reset-training-stimulus");
    expect(result.focusAreas.find((f) => f.id === "reset-training-stimulus")!.priority).toBe("low");
  });

  it("flags multiple independent rules at once", () => {
    const result = computePracticeCoachResult(
      baseSignals({ dnfRatePct: 20, practiceCount: 10, daysSinceLastPb: 60 })
    );
    expect(focusIds(result)).toEqual(["clean-up-solves", "build-recent-volume", "reset-training-stimulus"]);
  });

  it("sorts focus areas high before medium before low", () => {
    const result = computePracticeCoachResult(
      baseSignals({ dnfRatePct: 20, practiceCount: 10, daysSinceLastPb: 60 })
    );
    expect(result.focusAreas.map((f) => f.priority)).toEqual(["high", "medium", "low"]);
  });

  it("caps focus areas at 3 and tie-breaks equal-priority rules by fixed rule order", () => {
    const allSixTrigger = baseSignals({
      dnfRatePct: 20,
      practiceStddevMs: 10000 * (CV_CAP + 0.05),
      practiceCount: 10,
      momentumMs: 10000 * (MOMENTUM_SENSITIVITY + 0.05),
      competitionGapPct: 0.12,
      daysSinceLastPb: 60,
    });
    const result = computePracticeCoachResult(allSixTrigger);
    expect(result.focusAreas).toHaveLength(3);
    // 2 high-priority rules (clean-up-solves, run-competition-simulations) fill
    // the first two slots in their fixed table order; the first medium-priority
    // rule in table order (stabilize-execution) takes the last slot.
    expect(focusIds(result)).toEqual(["clean-up-solves", "run-competition-simulations", "stabilize-execution"]);
  });

  it("passes the event through unchanged", () => {
    const result = computePracticeCoachResult(baseSignals({ event: "4x4x4" }));
    expect(result.event).toBe("4x4x4");
  });

  it("is deterministic - identical signals produce identical output", () => {
    const signals = baseSignals({ dnfRatePct: 20 });
    expect(computePracticeCoachResult(signals)).toEqual(computePracticeCoachResult(signals));
  });

  it("every evidence value traces back to a TrainingSignals field, not invented text", () => {
    const signals = baseSignals({ dnfRatePct: 25, plus2RatePct: 8 });
    const result = computePracticeCoachResult(signals);
    const cleanUp = result.focusAreas.find((f) => f.id === "clean-up-solves")!;
    expect(cleanUp.evidence).toEqual([
      { label: "DNF rate", value: "25.0%" },
      { label: "+2 rate", value: "8.0%" },
    ]);
  });

  it("contains no marketing language in its static strings", () => {
    const allSixTrigger = baseSignals({
      dnfRatePct: 20,
      practiceStddevMs: 10000 * (CV_CAP + 0.05),
      practiceCount: 10,
      momentumMs: 10000 * (MOMENTUM_SENSITIVITY + 0.05),
      competitionGapPct: 0.12,
      daysSinceLastPb: 60,
    });
    const result = computePracticeCoachResult(allSixTrigger);
    const strings = [
      result.summary,
      ...result.limitations,
      ...result.focusAreas.flatMap((f) => [f.title, f.reason, f.suggestedDrill, f.target, ...f.evidence.map((e) => e.label)]),
    ];
    const lowerJoined = strings.join(" ").toLowerCase();
    for (const banned of BANNED_WORDS) {
      expect(lowerJoined).not.toContain(banned);
    }
  });

  it("suggestedDrill comes from a fixed per-rule lookup, identical across calls and inputs", () => {
    const first = computePracticeCoachResult(baseSignals({ dnfRatePct: 20 }));
    const second = computePracticeCoachResult(baseSignals({ dnfRatePct: 99 }));
    expect(first.focusAreas.find((f) => f.id === "clean-up-solves")!.suggestedDrill).toBe(
      second.focusAreas.find((f) => f.id === "clean-up-solves")!.suggestedDrill
    );
  });
});
