// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ModelComparison from "../ModelComparison.jsx";

const metric = (modelId, label, overrides = {}) => ({
  modelId,
  label,
  evaluatedCount: 4,
  maeMs: 500,
  medianAeMs: 450,
  rmseMs: 600,
  mapePct: 5,
  biasMs: 100,
  cases: [],
  ...overrides,
});

const comparisonWithData = {
  event: "3x3x3",
  comparableCompetitionsFound: 4,
  bestModelId: "linear-regression",
  metrics: [
    metric("rule-based", "Rule-based", { maeMs: 800 }),
    metric("linear-regression", "Linear Regression", { maeMs: 300 }),
    metric("nearest-neighbor", "Nearest-Neighbor", { maeMs: 650 }),
  ],
};

describe("ModelComparison", () => {
  it("renders the empty state when there are fewer comparable competitions than required", () => {
    const comparison = { event: "3x3x3", comparableCompetitionsFound: 1, bestModelId: null, metrics: [] };
    render(
      <ModelComparison comparison={comparison} cubeDimension="3x3x3" explanation="Not enough historical data yet to compare prediction models." />
    );
    expect(screen.getByText(/Model comparison needs at least 3 comparable competitions/)).toBeInTheDocument();
    expect(screen.getByText("Comparable competitions found: 1")).toBeInTheDocument();
    expect(screen.getByText("Required minimum: 3")).toBeInTheDocument();
    expect(screen.getByText("Active event: 3x3x3")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a row per model with MAE, RMSE, bias, and evaluated count", () => {
    render(<ModelComparison comparison={comparisonWithData} cubeDimension="3x3x3" explanation="x" />);
    const table = screen.getByRole("table", { name: "Model comparison" });
    expect(within(table).getByText("Rule-based")).toBeInTheDocument();
    expect(within(table).getByText("Linear Regression")).toBeInTheDocument();
    expect(within(table).getByText("Nearest-Neighbor")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
  });

  it("highlights the best model with a BEST badge", () => {
    render(<ModelComparison comparison={comparisonWithData} cubeDimension="3x3x3" explanation="x" />);
    const badge = screen.getByText("BEST");
    const row = badge.closest("tr");
    expect(within(row).getByText("Linear Regression")).toBeInTheDocument();
  });

  it("renders the deterministic explanation text for the best model", () => {
    render(
      <ModelComparison
        comparison={comparisonWithData}
        cubeDimension="3x3x3"
        explanation="Linear regression is selected because it had the lowest historical MAE."
      />
    );
    expect(screen.getByText(/Linear regression is selected because it had the lowest historical MAE/)).toBeInTheDocument();
  });

  it("renders a dash for a model with no evaluated cases", () => {
    const comparison = {
      ...comparisonWithData,
      metrics: [
        metric("rule-based", "Rule-based", { evaluatedCount: 4, maeMs: 800 }),
        metric("linear-regression", "Linear Regression", { evaluatedCount: 0, maeMs: null, rmseMs: null, biasMs: null }),
        metric("nearest-neighbor", "Nearest-Neighbor", { evaluatedCount: 4, maeMs: 650 }),
      ],
      bestModelId: "rule-based",
    };
    render(<ModelComparison comparison={comparison} cubeDimension="3x3x3" explanation="x" />);
    const table = screen.getByRole("table", { name: "Model comparison" });
    const linearRow = within(table).getByText("Linear Regression").closest("tr");
    expect(within(linearRow).getByText("0")).toBeInTheDocument();
    expect(within(linearRow).getAllByText("-")).toHaveLength(3);
  });
});
