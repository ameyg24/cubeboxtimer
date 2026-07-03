// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CompetitionTab from "../CompetitionTab.jsx";
import { ThemeProvider } from "../ThemeContext.jsx";

// These tests drive CompetitionTab directly with in-memory props (no
// persistence layer) to isolate rendering, form validation, and
// accessibility. See CompetitionTab.integration.test.jsx for the same
// component wired to the real useCompetitionResults hook.
//
// Wrapped in ThemeProvider because the Prediction Quality section's chart
// (lazy-loaded) calls useTheme() — matching how App.jsx always wraps the
// real app in ThemeProvider.
const renderTab = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Chart.js's responsive-resize binding needs real canvas layout, which jsdom
// doesn't provide - the same reason no existing test renders StatsChart
// directly. Stub it out so mounting PredictionErrorChart doesn't crash;
// these tests assert on surrounding DOM, not chart rendering fidelity.
vi.mock("chart.js/auto", () => ({
  default: class MockChart {
    constructor() {
      this.data = { labels: [], datasets: [{ data: [] }, { data: [] }] };
    }
    update() {}
    destroy() {}
  },
}));

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

const noop = () => {};

const twoCompetitionFixture = () => ({
  practiceSolves: [
    solve(100, 10000), solve(96, 10000),
    solve(70, 10000), solve(66, 10000),
    solve(5, 10000), solve(2, 10000),
  ],
  competitions: [competition("c1", 90, 10500), competition("c2", 60, 10600)],
});

describe("CompetitionTab", () => {
  it("shows the no-history empty state with zero competitions", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    expect(screen.getByText("No competition history yet.")).toBeInTheDocument();
  });

  it("shows the more-history-needed message with exactly one competition", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[solve(5, 10000), solve(2, 10000)]}
        competitions={[competition("c1", 30, 11000)]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    expect(
      screen.getByText("More competition history is needed before a reliable prediction can be made.")
    ).toBeInTheDocument();
  });

  it("renders a real prediction and Why explanation with two or more competitions", () => {
    const { practiceSolves, competitions } = twoCompetitionFixture();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={practiceSolves}
        competitions={competitions}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    expect(screen.getByText("Predicted Competition Average")).toBeInTheDocument();
    expect(screen.getByText(/Confidence:/)).toBeInTheDocument();
    expect(screen.getByText(/Based on your last 2 competitions\./)).toBeInTheDocument();
    expect(screen.getByText("Why?")).toBeInTheDocument();
    expect(screen.getByText(/Your competition averages have historically been/)).toBeInTheDocument();
  });

  it("prediction empty state explains what's needed and shows competition/practice-match counts when there's history but no matching practice data", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[competition("c1", 90, 10500), competition("c2", 60, 10600)]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    const card = screen
      .getByText(/CubeBox found 2 3x3x3 competitions, but 0 have practice solves recorded/)
      .closest(".section-card");
    expect(within(card).getByText("Competitions for this event: 2")).toBeInTheDocument();
    expect(within(card).getByText("Competitions with matching practice data: 0")).toBeInTheDocument();
    expect(within(card).getByText("Required for prediction: at least 2")).toBeInTheDocument();
    expect(within(card).getByText(/Practice window: 14 days/)).toBeInTheDocument();
    expect(within(card).getByText(/Add past practice solves near those competition dates/)).toBeInTheDocument();
  });

  it("historical calibration empty state explains what's needed and shows competition/comparable counts", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[competition("c1", 90, 10500), competition("c2", 60, 10600)]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    const card = screen
      .getByText(/Historical calibration needs a competition result and practice solves/)
      .closest(".section-card");
    expect(within(card).getByText("Competition results for this event: 2")).toBeInTheDocument();
    expect(within(card).getByText("Comparable competitions found: 0")).toBeInTheDocument();
  });

  it("only shows competitions entered for the currently selected event", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="2x2x2"
        practiceSolves={[]}
        competitions={[competition("c1", 30, 11000, { event: "3x3x3" })]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    expect(screen.getByText("No competition history yet.")).toBeInTheDocument();
  });

  it("states which event's results are shown, and flags that other events have results too", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="2x2x2"
        practiceSolves={[]}
        competitions={[competition("c1", 30, 11000, { event: "3x3x3" })]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    expect(screen.getByText(/Showing 2x2x2 competition results\./)).toBeInTheDocument();
    expect(screen.getByText(/switch the cube size selector above/)).toBeInTheDocument();
  });

  it("doesn't mention other events when every competition already matches the active event", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[competition("c1", 30, 11000, { event: "3x3x3" })]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    expect(screen.getByText(/Showing 3x3x3 competition results\./)).toBeInTheDocument();
    expect(screen.queryByText(/switch the cube size selector above/)).not.toBeInTheDocument();
  });

  it("shows historical calibration rows newest first", () => {
    const { practiceSolves } = twoCompetitionFixture();
    const competitions = [
      competition("older", 90, 10500, { competitionName: "Older Comp" }),
      competition("newer", 60, 10600, { competitionName: "Newer Comp" }),
    ];
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={practiceSolves}
        competitions={competitions}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    const cells = screen.getAllByRole("cell", { name: /Comp$/ });
    expect(cells[0]).toHaveTextContent("Newer Comp");
    expect(cells[1]).toHaveTextContent("Older Comp");
  });

  it("lists competition results with edit and delete controls", () => {
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[competition("c1", 30, 11000, { competitionName: "Tokyo Open" })]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );
    expect(screen.getByText("Tokyo Open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Tokyo Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Tokyo Open" })).toBeInTheDocument();
  });

  it("deletes a competition when its delete button is clicked", async () => {
    const user = userEvent.setup();
    const deleteCompetitionResult = vi.fn();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[competition("c1", 30, 11000, { competitionName: "Tokyo Open" })]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={deleteCompetitionResult}
      />
    );
    await user.click(screen.getByRole("button", { name: "Delete Tokyo Open" }));
    expect(deleteCompetitionResult).toHaveBeenCalledWith("c1");
  });

  it("opens an accessible add form and validates required fields", async () => {
    const user = userEvent.setup();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Add Competition Result");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(within(dialog).getByText("Competition name is required.")).toHaveAttribute("role", "alert");
    expect(within(dialog).getByText("Date is required.")).toHaveAttribute("role", "alert");
    expect(within(dialog).getByText("Official average is required.")).toHaveAttribute("role", "alert");
  });

  it("rejects an impossible best-single value that's slower than the average", async () => {
    const user = userEvent.setup();
    const addCompetitionResult = vi.fn();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[]}
        addCompetitionResult={addCompetitionResult}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), "Winter Open");
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-03-01" } });
    await user.type(within(dialog).getByLabelText("Official Average (seconds)"), "12.00");
    await user.type(within(dialog).getByLabelText("Official Best Single (seconds, optional)"), "13.00");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(within(dialog).getByText("Best single can't be slower than the average.")).toHaveAttribute(
      "role",
      "alert"
    );
    expect(addCompetitionResult).not.toHaveBeenCalled();
  });

  it("rejects a non-positive average as an impossible value", async () => {
    const user = userEvent.setup();
    const addCompetitionResult = vi.fn();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[]}
        addCompetitionResult={addCompetitionResult}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), "Winter Open");
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-03-01" } });
    await user.type(within(dialog).getByLabelText("Official Average (seconds)"), "-5");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(within(dialog).getByText("Enter a realistic average, in seconds.")).toHaveAttribute("role", "alert");
    expect(addCompetitionResult).not.toHaveBeenCalled();
  });

  it("submits a valid add form with correctly converted values", async () => {
    const user = userEvent.setup();
    const addCompetitionResult = vi.fn();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[]}
        addCompetitionResult={addCompetitionResult}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), "Winter Open");
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-03-01" } });
    await user.type(within(dialog).getByLabelText("Official Average (seconds)"), "12.34");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(addCompetitionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        competitionName: "Winter Open",
        event: "3x3x3",
        averageMs: 12340,
        bestMs: null,
        source: "manual",
      })
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the edit form pre-filled with the competition's existing values", async () => {
    const user = userEvent.setup();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[competition("c1", 30, 11340, { competitionName: "Tokyo Open", bestMs: 9870 })]}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit Tokyo Open" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Edit Competition Result");
    expect(within(dialog).getByRole("textbox", { name: "Competition Name" })).toHaveValue("Tokyo Open");
    expect(within(dialog).getByLabelText("Official Average (seconds)")).toHaveValue(11.34);
    expect(within(dialog).getByLabelText("Official Best Single (seconds, optional)")).toHaveValue(9.87);
  });

  it("submits an edit with the updated values", async () => {
    const user = userEvent.setup();
    const updateCompetitionResult = vi.fn();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[competition("c1", 30, 11000, { competitionName: "Tokyo Open" })]}
        addCompetitionResult={noop}
        updateCompetitionResult={updateCompetitionResult}
        deleteCompetitionResult={noop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit Tokyo Open" }));
    const dialog = screen.getByRole("dialog");
    const avgField = within(dialog).getByLabelText("Official Average (seconds)");
    await user.clear(avgField);
    await user.type(avgField, "10.50");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateCompetitionResult).toHaveBeenCalledWith("c1", expect.objectContaining({ averageMs: 10500 }));
  });

  it("closes the form on Escape without calling the submit handler", async () => {
    const user = userEvent.setup();
    const addCompetitionResult = vi.fn();
    renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={[]}
        competitions={[]}
        addCompetitionResult={addCompetitionResult}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(addCompetitionResult).not.toHaveBeenCalled();
  });

  it("marks calibration table headers for screen readers and wraps the prediction in a live region", () => {
    const { practiceSolves, competitions } = twoCompetitionFixture();
    const { container } = renderTab(
      <CompetitionTab
        cubeDimension="3x3x3"
        practiceSolves={practiceSolves}
        competitions={competitions}
        addCompetitionResult={noop}
        updateCompetitionResult={noop}
        deleteCompetitionResult={noop}
      />
    );

    const columnHeaders = screen.getAllByRole("columnheader");
    expect(columnHeaders.length).toBeGreaterThan(0);
    columnHeaders.forEach((header) => expect(header).toHaveAttribute("scope", "col"));

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toHaveTextContent("Predicted Competition Average");
  });
});
