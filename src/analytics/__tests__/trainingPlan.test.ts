import { describe, it, expect } from "vitest";
import { buildTrainingPlan } from "../trainingPlan";
import type { FocusArea } from "../practiceCoach";

const focusArea = (id: string, priority: FocusArea["priority"]): FocusArea => ({
  id,
  title: id,
  priority,
  reason: "reason",
  evidence: [],
  suggestedDrill: "drill",
  target: "target",
});

describe("buildTrainingPlan", () => {
  it("puts high-priority focus areas in actNow", () => {
    const areas = [focusArea("a", "high"), focusArea("b", "high")];
    const plan = buildTrainingPlan(areas);
    expect(plan.actNow.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("puts medium and low priority focus areas in thisWeek", () => {
    const areas = [focusArea("a", "medium"), focusArea("b", "low")];
    const plan = buildTrainingPlan(areas);
    expect(plan.thisWeek.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("splits a mixed list correctly between actNow and thisWeek", () => {
    const areas = [focusArea("a", "high"), focusArea("b", "medium"), focusArea("c", "low")];
    const plan = buildTrainingPlan(areas);
    expect(plan.actNow.map((f) => f.id)).toEqual(["a"]);
    expect(plan.thisWeek.map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("omits beforeNextCompetition when no date is given", () => {
    const areas = [focusArea("a", "high")];
    const plan = buildTrainingPlan(areas);
    expect(plan.beforeNextCompetition).toEqual([]);
    expect(plan.limitations).toContain("No upcoming competition date set - before-competition plan not shown.");
  });

  it("populates beforeNextCompetition when a competition date is given", () => {
    const areas = [focusArea("a", "high"), focusArea("b", "medium")];
    const plan = buildTrainingPlan(areas, Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(plan.beforeNextCompetition.map((f) => f.id)).toEqual(["a", "b"]);
    expect(plan.limitations).toEqual([]);
  });

  it("gives an empty plan with no focus areas", () => {
    const plan = buildTrainingPlan([]);
    expect(plan.actNow).toEqual([]);
    expect(plan.thisWeek).toEqual([]);
    expect(plan.beforeNextCompetition).toEqual([]);
  });

  it("gives an empty plan with no focus areas even with a competition date set", () => {
    const plan = buildTrainingPlan([], Date.now() + 1000);
    expect(plan.actNow).toEqual([]);
    expect(plan.thisWeek).toEqual([]);
    expect(plan.beforeNextCompetition).toEqual([]);
    expect(plan.limitations).toEqual([]);
  });

  it("is deterministic - identical inputs produce identical output", () => {
    const areas = [focusArea("a", "high"), focusArea("b", "medium")];
    const date = Date.now();
    expect(buildTrainingPlan(areas, date)).toEqual(buildTrainingPlan(areas, date));
  });
});
