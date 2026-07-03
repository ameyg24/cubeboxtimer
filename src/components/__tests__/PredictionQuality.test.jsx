// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PredictionQuality from "../PredictionQuality.jsx";
import { ThemeProvider } from "../ThemeContext.jsx";
import { runBacktest } from "../../analytics";

// Chart.js's responsive-resize binding needs real canvas layout, which jsdom
// doesn't provide - the same reason no existing test renders StatsChart
// directly. Stub it out so mounting PredictionErrorChart doesn't crash.
vi.mock("chart.js/auto", () => ({
  default: class MockChart {
    constructor() {
      this.data = { labels: [], datasets: [{ data: [] }, { data: [] }] };
    }
    update() {}
    destroy() {}
  },
}));

// PredictionQuality now receives an already-computed `backtest` (CompetitionTab
// computes it once and shares it with PredictionBreakdown/Factors), so these
// tests compute it the same way via the real runBacktest, then render the
// component in isolation exactly as CompetitionTab would pass it down.
const renderWithData = (practiceSolves, competitionsForEvent, competitionsById) => {
  const backtest = runBacktest(practiceSolves, competitionsForEvent, "3x3x3");
  return render(
    <ThemeProvider>
      <PredictionQuality backtest={backtest} competitionCount={competitionsForEvent.length} competitionsById={competitionsById} />
    </ThemeProvider>
  );
};

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => Date.now() - n * DAY;

const solve = (daysBack, millis) => ({
  id: `s-${daysBack}-${millis}-${Math.random().toString(36).slice(2)}`,
  millis,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: daysAgo(daysBack),
});

const competition = (id, daysBack, averageMs, overrides = {}) => ({
  id,
  competitionName: `Competition ${id}`,
  date: new Date(daysAgo(daysBack)).toISOString(),
  event: "3x3x3",
  averageMs,
  bestMs: null,
  source: "manual",
  ...overrides,
});

// Two competitions with a comfortable practice window before each, so the
// later one is a real backtest-eligible case (the earlier one becomes its
// only prior).
function twoCompetitionFixture() {
  const practiceSolves = [
    solve(100, 10000), solve(96, 10000),
    solve(70, 10000), solve(66, 10000),
    solve(5, 10000), solve(2, 10000),
  ];
  const competitionsForEvent = [
    competition("c1", 90, 10500, { competitionName: "Older Comp" }),
    competition("c2", 60, 10600, { competitionName: "Newer Comp" }),
  ];
  const competitionsById = new Map(competitionsForEvent.map((c) => [c.id, c]));
  return { practiceSolves, competitionsForEvent, competitionsById };
}

describe("PredictionQuality", () => {
  it("explains that more competitions are needed with fewer than 2 entered", () => {
    renderWithData([], [competition("c1", 30, 11000)], new Map());
    expect(
      screen.getByText(/Backtesting needs at least 2 competitions for this event/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Average Error")).not.toBeInTheDocument();
  });

  it("explains that no evaluations were possible when competitions have no matching practice data", () => {
    const competitionsForEvent = [competition("c1", 400, 11000), competition("c2", 350, 10800)];
    renderWithData([], competitionsForEvent, new Map(competitionsForEvent.map((c) => [c.id, c])));
    expect(
      screen.getByText(/None of your competitions had enough matching practice data/)
    ).toBeInTheDocument();
  });

  it("does not fabricate a metric in either empty state", () => {
    renderWithData([], [], new Map());
    expect(screen.queryByText("RMSE")).not.toBeInTheDocument();
    expect(screen.queryByText(/Predictions Evaluated/)).not.toBeInTheDocument();
  });

  it("shows summary cards once at least one competition is evaluated", () => {
    const { practiceSolves, competitionsForEvent, competitionsById } = twoCompetitionFixture();
    renderWithData(practiceSolves, competitionsForEvent, competitionsById);
    expect(screen.getByText("Average Error")).toBeInTheDocument();
    expect(screen.getByText("Median Error")).toBeInTheDocument();
    expect(screen.getByText("RMSE")).toBeInTheDocument();
    expect(screen.getByText("Predictions Evaluated")).toBeInTheDocument();
    // "Bias" appears twice: the summary card label and the table column header.
    expect(screen.getAllByText("Bias")).toHaveLength(2);
    // Only "c2" (the later competition) has an earlier competition to learn from.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows the prediction history table with the evaluated competition's name and confidence", () => {
    const { practiceSolves, competitionsForEvent, competitionsById } = twoCompetitionFixture();
    renderWithData(practiceSolves, competitionsForEvent, competitionsById);
    expect(screen.getByText("Prediction History")).toBeInTheDocument();
    expect(screen.getByText("Newer Comp")).toBeInTheDocument();
    // "Older Comp" was never itself scored (nothing prior to it).
    expect(screen.queryByText("Older Comp")).not.toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument(); // confidence badge, 1 prior competition
  });

  it("marks the prediction history table headers for screen readers", () => {
    const { practiceSolves, competitionsForEvent, competitionsById } = twoCompetitionFixture();
    renderWithData(practiceSolves, competitionsForEvent, competitionsById);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.length).toBeGreaterThan(0);
    headers.forEach((header) => expect(header).toHaveAttribute("scope", "col"));
  });

  it("wraps the summary in a live region so screen readers hear updates", () => {
    const { practiceSolves, competitionsForEvent, competitionsById } = twoCompetitionFixture();
    const { container } = renderWithData(practiceSolves, competitionsForEvent, competitionsById);
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toHaveTextContent("Average Error");
  });

  it("shows the newest evaluated competition first when multiple exist", () => {
    const practiceSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(40, 10000), solve(36, 10000),
    ];
    const competitionsForEvent = [
      competition("c1", 90, 10500, { competitionName: "First" }),
      competition("c2", 60, 10600, { competitionName: "Second" }),
      competition("c3", 30, 10700, { competitionName: "Third" }),
    ];
    const competitionsById = new Map(competitionsForEvent.map((c) => [c.id, c]));
    renderWithData(practiceSolves, competitionsForEvent, competitionsById);
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    // "Third" (newest, evaluated using c1+c2 as history) should lead.
    expect(within(rows[0]).getByText("Third")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Second")).toBeInTheDocument();
  });

  it("shows the prediction error chart once there is evaluated data", () => {
    const { practiceSolves, competitionsForEvent, competitionsById } = twoCompetitionFixture();
    renderWithData(practiceSolves, competitionsForEvent, competitionsById);
    expect(screen.getByText("Prediction Error Over Time")).toBeInTheDocument();
  });
});
