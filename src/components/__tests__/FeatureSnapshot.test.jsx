// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FeatureSnapshot from "../FeatureSnapshot.jsx";

const baseFeatures = {
  practiceMeanMs: 10234,
  practiceAo5Ms: 10100,
  practiceAo12Ms: 10300,
  practiceAo50Ms: null,
  practiceCount: 7,
  practiceStddevMs: 450,
  dnfRatePct: 14.3,
  plus2RatePct: 0,
  practiceBestMs: 9500,
  daysSincePreviousCompetition: 20,
  averageCompetitionGapDays: 30,
  priorCompetitionCount: 3,
  priorPredictionErrorMs: null,
};

describe("FeatureSnapshot", () => {
  it("shows practice mean, solve count, consistency, DNF rate, and prior competitions", () => {
    render(<FeatureSnapshot features={baseFeatures} />);
    expect(screen.getByText("Feature Snapshot")).toBeInTheDocument();
    expect(screen.getByText("10.23s")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("0.45s")).toBeInTheDocument();
    expect(screen.getByText("14.3%")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an empty state instead of fabricated stats when there's no practice data", () => {
    render(<FeatureSnapshot features={{ ...baseFeatures, practiceMeanMs: null }} />);
    expect(screen.getByText(/Not enough recent practice data/)).toBeInTheDocument();
    expect(screen.queryByText("Feature Snapshot")).not.toBeInTheDocument();
  });

  it("renders a dash for consistency when stddev is unavailable", () => {
    render(<FeatureSnapshot features={{ ...baseFeatures, practiceStddevMs: null }} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
