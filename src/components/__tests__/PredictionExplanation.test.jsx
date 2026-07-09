// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PredictionBreakdown, PredictionFactors } from "../PredictionExplanation.jsx";

const baseExplanation = (overrides = {}) => ({
  practiceAverageMs: 10000,
  adjustmentFactorPct: 0.1,
  predictedAverageMs: 11000,
  confidenceLevel: "medium",
  confidenceIntervalMs: [10500, 11500],
  competitionsUsed: 3,
  dnfProbabilityPct: 10,
  historicalAverageErrorPct: 5.5,
  factors: {
    practicePerformancePct: 54.1,
    historicalAdjustmentPct: 5.4,
    consistencyPct: 2.7,
    dnfHistoryPct: 5.4,
    competitionHistoryPct: 32.4,
  },
  ...overrides,
});

describe("PredictionBreakdown", () => {
  it("renders nothing when show is false", () => {
    const { container } = render(<PredictionBreakdown explanation={baseExplanation()} show={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an empty-state message instead of fabricating a breakdown when there are no factors", () => {
    render(<PredictionBreakdown explanation={baseExplanation({ factors: null })} show={true} />);
    expect(screen.getByText("Not enough data yet for a detailed breakdown.")).toBeInTheDocument();
    expect(screen.queryByText("Prediction Breakdown")).not.toBeInTheDocument();
  });

  it("renders every documented value: practice average, adjustment factor, predicted average, confidence, competitions used, DNF probability", () => {
    render(<PredictionBreakdown explanation={baseExplanation()} show={true} />);

    expect(screen.getByText("Prediction Breakdown")).toBeInTheDocument();
    expect(screen.getByText("10.00")).toBeInTheDocument(); // practice average
    expect(screen.getByText("+10.0%")).toBeInTheDocument(); // adjustment factor
    expect(screen.getByText("11.00")).toBeInTheDocument(); // predicted average
    expect(screen.getByText("10.50 - 11.50")).toBeInTheDocument(); // confidence interval
    expect(screen.getByText("Medium")).toBeInTheDocument(); // confidence badge
    expect(screen.getByText("3")).toBeInTheDocument(); // competitions used
    expect(screen.getByText("10.0%")).toBeInTheDocument(); // DNF probability
    expect(screen.getByText("5.5%")).toBeInTheDocument(); // historical average error
  });

  it("shows a fallback message for historical average error instead of a fabricated number when backtest history is insufficient", () => {
    render(<PredictionBreakdown explanation={baseExplanation({ historicalAverageErrorPct: null })} show={true} />);
    expect(screen.getByText("Not enough backtest history")).toBeInTheDocument();
  });

  it("shows a negative adjustment factor with the correct sign", () => {
    render(<PredictionBreakdown explanation={baseExplanation({ adjustmentFactorPct: -0.08 })} show={true} />);
    expect(screen.getByText("-8.0%")).toBeInTheDocument();
  });
});

describe("PredictionFactors", () => {
  it("renders nothing when show is false", () => {
    const { container } = render(<PredictionFactors factors={baseExplanation().factors} show={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an empty-state message instead of fabricating factors when there are none", () => {
    render(<PredictionFactors factors={null} show={true} />);
    expect(screen.getByText("Not enough data yet to break down prediction factors.")).toBeInTheDocument();
    expect(screen.queryByText("Prediction Factors")).not.toBeInTheDocument();
  });

  it("renders all five factor labels and their percentages", () => {
    render(<PredictionFactors factors={baseExplanation().factors} show={true} />);

    expect(screen.getByText("Prediction Factors")).toBeInTheDocument();
    expect(screen.getByText("Practice performance")).toBeInTheDocument();
    expect(screen.getByText("Historical adjustment")).toBeInTheDocument();
    expect(screen.getByText("Consistency")).toBeInTheDocument();
    expect(screen.getByText("DNF history")).toBeInTheDocument();
    expect(screen.getByText("Competition history")).toBeInTheDocument();

    expect(screen.getByText("54.1%")).toBeInTheDocument();
    // historicalAdjustment and dnfHistory happen to match (5.4%) in this fixture.
    expect(screen.getAllByText("5.4%")).toHaveLength(2);
    expect(screen.getByText("2.7%")).toBeInTheDocument();
    expect(screen.getByText("32.4%")).toBeInTheDocument();
  });

  it("sets each bar's fill width to its percentage", () => {
    const { container } = render(<PredictionFactors factors={baseExplanation().factors} show={true} />);
    const fills = container.querySelectorAll('[style*="width: 54.1%"], [style*="width: 32.4%"]');
    expect(fills.length).toBeGreaterThan(0);
  });

  it("renders percentages that sum to (approximately) 100%", () => {
    const factors = baseExplanation().factors;
    render(<PredictionFactors factors={factors} show={true} />);
    const sum = Object.values(factors).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 0);
  });
});
