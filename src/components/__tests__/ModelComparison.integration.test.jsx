// @vitest-environment jsdom
//
// Full integration: the real useSolveSessions/useCompetitionResults hooks
// wired to CompetitionTab + SolveList, exactly how App.jsx composes them -
// mirrors PracticeBackfill.integration.test.jsx and
// CsTimerImport.integration.test.jsx, but exercises the Model Comparison /
// Feature Snapshot sections instead of the rule-based prediction alone.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSolveSessions } from "../../hooks/useSolveSessions.js";
import { useCompetitionResults } from "../../hooks/useCompetitionResults.js";
import CompetitionTab from "../CompetitionTab.jsx";
import SolveList from "../SolveList.jsx";
import { ThemeProvider } from "../ThemeContext.jsx";
import { fetchWcaCompetitionMeta, fetchWcaPersonResults } from "../../hooks/wcaApi.js";

vi.mock("chart.js/auto", () => ({
  default: class MockChart {
    constructor() {
      this.data = { labels: [], datasets: [{ data: [] }, { data: [] }] };
    }
    update() {}
    destroy() {}
  },
}));

vi.mock("../../hooks/wcaApi.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchWcaPersonResults: vi.fn(), fetchWcaCompetitionMeta: vi.fn() };
});

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => Date.now() - n * DAY;
const dateInput = (n) => new Date(daysAgo(n)).toISOString().slice(0, 10);

function Harness({ cubeDimension = "3x3x3" }) {
  const { eventSolves, allSolves, addSolve, updateSolve, deleteSolve, sessions } = useSolveSessions({
    user: null,
    cubeDimension,
  });
  const { competitions, addCompetitionResult, updateCompetitionResult, deleteCompetitionResult } =
    useCompetitionResults({ user: null });
  return (
    <ThemeProvider>
      <CompetitionTab
        cubeDimension={cubeDimension}
        practiceSolves={allSolves}
        competitions={competitions}
        addCompetitionResult={addCompetitionResult}
        updateCompetitionResult={updateCompetitionResult}
        deleteCompetitionResult={deleteCompetitionResult}
      />
      <SolveList
        solves={eventSolves}
        updateSolve={updateSolve}
        deleteSolve={deleteSolve}
        addSolve={addSolve}
        cubeDimension={cubeDimension}
        sessions={sessions}
      />
    </ThemeProvider>
  );
}

async function addCompetition(user, { name, date, average }) {
  await user.click(screen.getByRole("button", { name: "Add competition" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), name);
  fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: date } });
  await user.type(within(dialog).getByLabelText("Official Average (seconds)"), average);
  await user.click(within(dialog).getByRole("button", { name: "Add" }));
}

async function addPastSolve(user, { date, timeSeconds }) {
  await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: date } });
  await user.type(within(dialog).getByLabelText(/Time \(seconds\)/), timeSeconds);
  await user.click(within(dialog).getByRole("button", { name: "Add" }));
}

async function importCsTimerData(user, content) {
  await user.click(screen.getByRole("button", { name: /Import csTimer/ }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Or paste export data"), { target: { value: content } });
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
}

const csTimerEntry = (rawTimeMs, timestampSeconds) => [[0, rawTimeMs], "R U R' U'", "", timestampSeconds];
const csTimerExportOf = (entries) => JSON.stringify({ session1: entries });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("Model Comparison and Feature Snapshot integration", () => {
  it("shows the Model Comparison empty state before enough competition history exists", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addCompetition(user, { name: "First Comp", date: dateInput(90), average: "10.50" });
    await addCompetition(user, { name: "Second Comp", date: dateInput(60), average: "10.60" });

    expect(screen.getByText("Model Comparison")).toBeInTheDocument();
    expect(screen.getByText(/Model comparison needs at least 3 comparable competitions/)).toBeInTheDocument();
  });

  it("renders the Model Comparison table with a highlighted best model once enough competitions and practice exist", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addCompetition(user, { name: "First Comp", date: dateInput(100), average: "10.50" });
    await addPastSolve(user, { date: dateInput(106), timeSeconds: "10.00" });
    await addCompetition(user, { name: "Second Comp", date: dateInput(70), average: "10.55" });
    await addPastSolve(user, { date: dateInput(76), timeSeconds: "10.05" });
    await addCompetition(user, { name: "Third Comp", date: dateInput(40), average: "10.60" });
    await addPastSolve(user, { date: dateInput(46), timeSeconds: "10.10" });
    await addCompetition(user, { name: "Fourth Comp", date: dateInput(10), average: "10.65" });
    await addPastSolve(user, { date: dateInput(16), timeSeconds: "10.15" });

    const table = await screen.findByRole("table", { name: "Model comparison" });
    expect(within(table).getByText("Rule-based")).toBeInTheDocument();
    expect(within(table).getByText("Linear Regression")).toBeInTheDocument();
    expect(within(table).getByText("Nearest-Neighbor")).toBeInTheDocument();
    expect(screen.getByText("BEST")).toBeInTheDocument();
  });

  it("updates the Feature Snapshot when new solves are added", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText(/Not enough recent practice data/)).toBeInTheDocument();

    await addPastSolve(user, { date: dateInput(1), timeSeconds: "10.00" });
    expect(screen.getByText("Feature Snapshot")).toBeInTheDocument();
    expect(screen.getByText("10.00s")).toBeInTheDocument();

    await addPastSolve(user, { date: dateInput(1), timeSeconds: "20.00" });
    expect(screen.getByText("15.00s")).toBeInTheDocument();
  });

  it("feeds imported csTimer practice solves into the feature pipeline and model evaluation", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addCompetition(user, { name: "First Comp", date: dateInput(100), average: "10.50" });
    await addCompetition(user, { name: "Second Comp", date: dateInput(70), average: "10.55" });
    await addCompetition(user, { name: "Third Comp", date: dateInput(40), average: "10.60" });
    await addCompetition(user, { name: "Fourth Comp", date: dateInput(10), average: "10.65" });

    const secondsAgo = (n) => Math.floor(daysAgo(n) / 1000);
    await importCsTimerData(
      user,
      csTimerExportOf([
        csTimerEntry(10000, secondsAgo(106)),
        csTimerEntry(10050, secondsAgo(76)),
        csTimerEntry(10100, secondsAgo(46)),
        csTimerEntry(10150, secondsAgo(16)),
        csTimerEntry(10200, secondsAgo(2)), // inside the live 14-day feature window
      ])
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 5 solves"));

    expect(screen.getByText("Feature Snapshot")).toBeInTheDocument();
    expect(screen.getByText("10.20s")).toBeInTheDocument();
    await screen.findByRole("table", { name: "Model comparison" });
  });

  it("feeds imported WCA competition results into model evaluation", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      { competition_id: "CompA", event_id: "333", round_id: 1, best: 950, average: 1050 },
      { competition_id: "CompB", event_id: "333", round_id: 1, best: 955, average: 1055 },
      { competition_id: "CompC", event_id: "333", round_id: 1, best: 960, average: 1060 },
      { competition_id: "CompD", event_id: "333", round_id: 1, best: 965, average: 1065 },
    ]);
    fetchWcaCompetitionMeta.mockImplementation((id) => {
      const byId = {
        CompA: { name: "Comp A", date: new Date(daysAgo(100)).toISOString() },
        CompB: { name: "Comp B", date: new Date(daysAgo(70)).toISOString() },
        CompC: { name: "Comp C", date: new Date(daysAgo(40)).toISOString() },
        CompD: { name: "Comp D", date: new Date(daysAgo(10)).toISOString() },
      };
      return Promise.resolve(byId[id]);
    });

    const user = userEvent.setup();
    render(<Harness />);

    await addPastSolve(user, { date: dateInput(106), timeSeconds: "10.00" });
    await addPastSolve(user, { date: dateInput(76), timeSeconds: "10.05" });
    await addPastSolve(user, { date: dateInput(46), timeSeconds: "10.10" });
    await addPastSolve(user, { date: dateInput(16), timeSeconds: "10.15" });
    await addPastSolve(user, { date: dateInput(2), timeSeconds: "10.15" }); // inside the live 14-day feature window

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Imported 4 new results/));

    const table = await screen.findByRole("table", { name: "Model comparison" });
    expect(within(table).getByText("Rule-based")).toBeInTheDocument();
  });
});
