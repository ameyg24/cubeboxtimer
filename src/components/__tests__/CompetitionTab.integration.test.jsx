// @vitest-environment jsdom
//
// Integration tests: the real useCompetitionResults hook (localStorage-only,
// no signed-in user) wired to the real CompetitionTab component, exactly how
// App.jsx wires them. CompetitionTab.test.jsx covers rendering/validation in
// isolation with mocked callbacks; these tests instead exercise persistence -
// add/edit/delete surviving a reload, and the prediction updating as the
// underlying data changes.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCompetitionResults } from "../../hooks/useCompetitionResults.js";
import CompetitionTab from "../CompetitionTab.jsx";
import { ThemeProvider } from "../ThemeContext.jsx";
import { fetchWcaCompetitionMeta, fetchWcaPersonResults } from "../../hooks/wcaApi.js";
import { createIndexedDbRepository } from "../../storage/indexedDb";
import { useEffect } from "react";
import { analyticsClient } from "../../worker/analyticsClient";

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

// No real network calls in tests - WCA import tests below mock the fetch
// layer only, leaving the real useWcaImport/analytics/wcaImport.ts logic
// under test.
vi.mock("../../hooks/wcaApi.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchWcaPersonResults: vi.fn(),
    fetchWcaCompetitionMeta: vi.fn(),
  };
});

// Durable data lives in IndexedDB; persistence assertions read it back
// through the repository (writes are asynchronous, hence waitFor).
const waitForPersisted = (assert) =>
  waitFor(async () => assert(await createIndexedDbRepository().loadCompetitions()));

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => Date.now() - n * DAY;

const solve = (daysBack, millis) => ({
  id: `s-${daysBack}-${millis}-${Math.random().toString(36).slice(2)}`,
  millis,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: daysAgo(daysBack),
});

// Wrapped in ThemeProvider because the Prediction Quality section's chart
// (lazy-loaded) calls useTheme() - matching how App.jsx always wraps the
// real app in ThemeProvider.
function Harness({ practiceSolves = [], cubeDimension = "3x3x3" }) {
  const { competitions, hydrated, addCompetitionResult, updateCompetitionResult, deleteCompetitionResult } =
    useCompetitionResults({ user: null });
  // This harness has no session hook; practice solves arrive as a prop.
  useEffect(() => {
    if (!hydrated) return;
    analyticsClient.setDataset({
      solvesByEvent: { "2x2x2": [], "3x3x3": practiceSolves, "4x4x4": [], "5x5x5": [] },
      competitions,
    });
  }, [hydrated, practiceSolves, competitions]);
  return (
    <ThemeProvider>
      {hydrated && <span data-testid="hydrated" hidden />}
      <CompetitionTab
        cubeDimension={cubeDimension}
        practiceSolves={practiceSolves}
        competitions={competitions}
        addCompetitionResult={addCompetitionResult}
        updateCompetitionResult={updateCompetitionResult}
        deleteCompetitionResult={deleteCompetitionResult}
      />
    </ThemeProvider>
  );
}

async function fillAndSubmit(user, dialog, { name, date, average, submitLabel = "Add" }) {
  if (name !== undefined) {
    await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), name);
  }
  if (date !== undefined) {
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: date } });
  }
  if (average !== undefined) {
    await user.type(within(dialog).getByLabelText("Official Average (seconds)"), average);
  }
  await user.click(within(dialog).getByRole("button", { name: submitLabel }));
}

// IndexedDB hydration is asynchronous; the harness surfaces a marker once
// the hook has hydrated so tests interact only with hydrated state.
async function renderHydrated(ui) {
  const utils = render(ui);
  await screen.findAllByTestId("hydrated");
  // Worker analytics arrive asynchronously after the dataset push.
  await waitFor(
    () => expect(screen.queryByText("Computing competition analytics...")).not.toBeInTheDocument(),
    // Generous wall-clock budget: see CoachTab.test.jsx renderCoach.
    { timeout: 10000 }
  );
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("CompetitionTab wired to useCompetitionResults", () => {
  it("shows the no-history empty state before anything is entered", async () => {
    await renderHydrated(<Harness />);
    expect(screen.getByText("No competition history yet.")).toBeInTheDocument();
  });

  it("adds a competition through the form and persists it to localStorage", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Tokyo Open")).toBeInTheDocument();

    await waitForPersisted((persisted) => {
      expect(persisted).toHaveLength(1);
      expect(persisted[0].competitionName).toBe("Tokyo Open");
      expect(persisted[0].averageMs).toBe(13200);
    });
  });

  it("shows the more-history-needed message after exactly one competition is added", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness practiceSolves={[solve(5, 10000), solve(2, 10000)]} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });

    expect(
      screen.getByText("More competition history is needed before a reliable prediction can be made.")
    ).toBeInTheDocument();
  });

  it("updates the prediction after a second competition is added", async () => {
    const user = userEvent.setup();
    const practiceSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(5, 10000), solve(2, 10000),
    ];
    await renderHydrated(<Harness practiceSolves={practiceSolves} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "First Comp",
      date: new Date(daysAgo(90)).toISOString().slice(0, 10),
      average: "10.50",
    });
    expect(
      screen.getByText("More competition history is needed before a reliable prediction can be made.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Second Comp",
      date: new Date(daysAgo(60)).toISOString().slice(0, 10),
      average: "10.60",
    });

    expect(screen.getByText("Predicted Competition Average")).toBeInTheDocument();
    expect(screen.getByText(/Based on your last 2 competitions\./)).toBeInTheDocument();
  });

  it("edits a competition and reflects the change in the list and localStorage", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });

    await user.click(screen.getByRole("button", { name: "Edit Tokyo Open" }));
    const dialog = screen.getByRole("dialog");
    const nameField = within(dialog).getByRole("textbox", { name: "Competition Name" });
    await user.clear(nameField);
    await user.type(nameField, "Tokyo Open 2026");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(screen.getByText("Tokyo Open 2026")).toBeInTheDocument();
    await waitForPersisted((persisted) => expect(persisted[0].competitionName).toBe("Tokyo Open 2026"));
  });

  it("deletes a competition and it disappears from the list and localStorage", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });
    expect(screen.getByText("Tokyo Open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Tokyo Open" }));

    expect(screen.queryByText("Tokyo Open")).not.toBeInTheDocument();
    expect(screen.getByText("No competition history yet.")).toBeInTheDocument();
    await waitForPersisted((persisted) => expect(persisted).toHaveLength(0));
  });

  it("survives a reload: unmounting and remounting rehydrates from localStorage", async () => {
    const user = userEvent.setup();
    const { unmount } = await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });
    unmount();

    await renderHydrated(<Harness />);
    expect(await screen.findByText("Tokyo Open")).toBeInTheDocument();
  });

  it("does not show a competition entered for a different event", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness cubeDimension="3x3x3" />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Event"), "2x2x2");
    await fillAndSubmit(user, dialog, { name: "2x2 Comp", date: "2026-03-01", average: "3.20" });

    expect(screen.getByText("No competition history yet.")).toBeInTheDocument();
    await waitForPersisted((persisted) => expect(persisted[0].event).toBe("2x2x2"));
  });

  it("Prediction Quality explains it needs more history with only one competition entered", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });

    expect(
      screen.getByText(/Backtesting needs at least 2 competitions for this event/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Predictions Evaluated")).not.toBeInTheDocument();
  });

  it("Prediction Quality evaluates a competition once a real prediction can be backtested against it", async () => {
    const user = userEvent.setup();
    const practiceSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(5, 10000), solve(2, 10000),
    ];
    await renderHydrated(<Harness practiceSolves={practiceSolves} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "First Comp",
      date: new Date(daysAgo(90)).toISOString().slice(0, 10),
      average: "10.50",
    });
    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Second Comp",
      date: new Date(daysAgo(60)).toISOString().slice(0, 10),
      average: "10.60",
    });

    expect(screen.getByText("Predictions Evaluated")).toBeInTheDocument();
    expect(screen.getByText("Prediction History")).toBeInTheDocument();
    // Only "Second Comp" has an earlier competition ("First Comp") to backtest from.
    const historyTable = screen.getByRole("table", { name: "Prediction history" });
    const historyRows = within(historyTable).getAllByRole("row").slice(1);
    expect(historyRows).toHaveLength(1);
    expect(within(historyRows[0]).getByText("Second Comp")).toBeInTheDocument();
  });

  it("Prediction Quality results survive a reload", async () => {
    const user = userEvent.setup();
    const practiceSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(5, 10000), solve(2, 10000),
    ];
    const { unmount } = await renderHydrated(<Harness practiceSolves={practiceSolves} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "First Comp",
      date: new Date(daysAgo(90)).toISOString().slice(0, 10),
      average: "10.50",
    });
    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Second Comp",
      date: new Date(daysAgo(60)).toISOString().slice(0, 10),
      average: "10.60",
    });
    expect(screen.getByText("Predictions Evaluated")).toBeInTheDocument();
    unmount();

    await renderHydrated(<Harness practiceSolves={practiceSolves} />);
    expect(await screen.findByText("Predictions Evaluated")).toBeInTheDocument();
    const historyTable = screen.getByRole("table", { name: "Prediction history" });
    expect(within(historyTable).getByText("Second Comp")).toBeInTheDocument();
  });

  it("Prediction Breakdown and Factors render for a real prediction, wired to the real hook", async () => {
    const user = userEvent.setup();
    const practiceSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(5, 10000), solve(2, 10000),
    ];
    await renderHydrated(<Harness practiceSolves={practiceSolves} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "First Comp",
      date: new Date(daysAgo(90)).toISOString().slice(0, 10),
      average: "10.50",
    });
    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Second Comp",
      date: new Date(daysAgo(60)).toISOString().slice(0, 10),
      average: "10.60",
    });

    expect(screen.getByText("Prediction Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Prediction Factors")).toBeInTheDocument();
    expect(screen.getByText("Practice performance")).toBeInTheDocument();
    expect(screen.getByText("Competition history")).toBeInTheDocument();
  });

  it("Prediction Breakdown updates after editing a competition's average", async () => {
    const user = userEvent.setup();
    const practiceSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(5, 10000), solve(2, 10000),
    ];
    await renderHydrated(<Harness practiceSolves={practiceSolves} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "First Comp",
      date: new Date(daysAgo(90)).toISOString().slice(0, 10),
      average: "10.50",
    });
    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Second Comp",
      date: new Date(daysAgo(60)).toISOString().slice(0, 10),
      average: "10.60",
    });

    const breakdownCard = screen.getByText("Prediction Breakdown").closest(".section-card");
    const before = within(breakdownCard).getByText(/Adjustment factor/).closest(".summary-row").textContent;

    await user.click(screen.getByRole("button", { name: "Edit Second Comp" }));
    const editDialog = screen.getByRole("dialog");
    const avgField = within(editDialog).getByLabelText("Official Average (seconds)");
    await user.clear(avgField);
    await user.type(avgField, "13.00");
    await user.click(within(editDialog).getByRole("button", { name: "Save" }));

    const after = within(breakdownCard).getByText(/Adjustment factor/).closest(".summary-row").textContent;
    expect(after).not.toBe(before);
  });

  it("Prediction Breakdown updates after new solves are added", async () => {
    const user = userEvent.setup();
    const initialSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(5, 10000), solve(2, 10000),
    ];
    const { rerender } = await renderHydrated(<Harness practiceSolves={initialSolves} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "First Comp",
      date: new Date(daysAgo(90)).toISOString().slice(0, 10),
      average: "10.50",
    });
    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Second Comp",
      date: new Date(daysAgo(60)).toISOString().slice(0, 10),
      average: "10.60",
    });

    const breakdownCard = screen.getByText("Prediction Breakdown").closest(".section-card");
    const before = within(breakdownCard).getByText(/Practice average/).closest(".summary-row").textContent;

    // Simulate new, notably slower solves being recorded elsewhere in the app.
    const updatedSolves = [...initialSolves, solve(1, 15000), solve(0, 15000)];
    rerender(<Harness practiceSolves={updatedSolves} />);

    await waitFor(() => {
      const after = within(breakdownCard).getByText(/Practice average/).closest(".summary-row").textContent;
      expect(after).not.toBe(before);
    });
  });

  it("Prediction Breakdown and Factors survive a reload", async () => {
    const user = userEvent.setup();
    const practiceSolves = [
      solve(100, 10000), solve(96, 10000),
      solve(70, 10000), solve(66, 10000),
      solve(5, 10000), solve(2, 10000),
    ];
    const { unmount } = await renderHydrated(<Harness practiceSolves={practiceSolves} />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "First Comp",
      date: new Date(daysAgo(90)).toISOString().slice(0, 10),
      average: "10.50",
    });
    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Second Comp",
      date: new Date(daysAgo(60)).toISOString().slice(0, 10),
      average: "10.60",
    });

    const breakdownCard = screen.getByText("Prediction Breakdown").closest(".section-card");
    const before = within(breakdownCard).getByText(/Adjustment factor/).closest(".summary-row").textContent;
    unmount();

    await renderHydrated(<Harness practiceSolves={practiceSolves} />);
    expect(await screen.findByText("Prediction Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Prediction Factors")).toBeInTheDocument();
    const reloadedCard = screen.getByText("Prediction Breakdown").closest(".section-card");
    const after = within(reloadedCard).getByText(/Adjustment factor/).closest(".summary-row").textContent;
    expect(after).toBe(before);
  });

  it("manual-first then import: an identical manual result is recognized as already present, not duplicated", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      { competition_id: "NewZealandChamps2009", event_id: "333", round_id: 1, best: 1005, average: 1374 },
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });

    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const addDialog = screen.getByRole("dialog");
    await user.type(
      within(addDialog).getByRole("textbox", { name: "Competition Name" }),
      "New Zealand Championships 2009"
    );
    fireEvent.change(within(addDialog).getByLabelText("Date"), { target: { value: "2009-07-18" } });
    await user.type(within(addDialog).getByLabelText("Official Average (seconds)"), "13.74");
    await user.type(within(addDialog).getByLabelText("Official Best Single (seconds, optional)"), "10.05");
    await user.click(within(addDialog).getByRole("button", { name: "Add" }));
    expect(screen.getByText("New Zealand Championships 2009")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Skipped 1 duplicate/));
    // Still exactly one record - the import recognized the manual entry as
    // the same result rather than creating a second one.
    await waitForPersisted((persisted) => {
      expect(persisted).toHaveLength(1);
      expect(persisted[0].source).toBe("manual");
    });
  });

  it("import-first then manual: a manual entry matching an existing WCA import is blocked as a duplicate", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      { competition_id: "NewZealandChamps2009", event_id: "333", round_id: 1, best: 1005, average: 1374 },
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });

    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Imported 1 new result/));

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Competition Name" }),
      "New Zealand Championships 2009"
    );
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2009-07-18" } });
    await user.type(within(dialog).getByLabelText("Official Average (seconds)"), "13.74");
    await user.type(within(dialog).getByLabelText("Official Best Single (seconds, optional)"), "10.05");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/already exists/);
    await waitForPersisted((persisted) => {
      expect(persisted).toHaveLength(1);
      expect(persisted[0].source).toBe("wca-import");
    });
  });

  it("shows a conflict warning (not a silent overwrite) when a manual entry shares event/date/name with an existing result but different times, and requires confirmation to proceed", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), "Tokyo Open");
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-03-01" } });
    await user.type(within(dialog).getByLabelText("Official Average (seconds)"), "14.00");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(/already has a result/);
    await waitForPersisted((persisted) => expect(persisted).toHaveLength(1)); // not yet created - warning only

    await user.click(within(dialog).getByRole("button", { name: "Add anyway" }));
    await waitForPersisted((persisted) => expect(persisted).toHaveLength(2));
  });

  it("clears a pending conflict confirmation when the form is edited afterward", async () => {
    const user = userEvent.setup();
    await renderHydrated(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), "Tokyo Open");
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-03-01" } });
    await user.type(within(dialog).getByLabelText("Official Average (seconds)"), "14.00");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/already has a result/);

    const avgField = within(dialog).getByLabelText("Official Average (seconds)");
    await user.clear(avgField);
    await user.type(avgField, "15.00");

    expect(within(dialog).getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add anyway" })).not.toBeInTheDocument();
  });
});
