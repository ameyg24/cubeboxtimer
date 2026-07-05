// @vitest-environment jsdom
//
// Full integration: the real useSolveSessions/useCompetitionResults hooks
// wired to CoachTab, CompetitionTab (for WCA import), and SolveList (for
// csTimer import and manual backfill) - mirrors
// ModelComparison.integration.test.jsx. Coach output is derived, recomputed
// on every render from already-persisted solves/competitions - no reload
// persistence test is needed here for the same reason ModelComparison and
// PredictionQuality don't have one either.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSolveSessions } from "../../hooks/useSolveSessions.js";
import { useCompetitionResults } from "../../hooks/useCompetitionResults.js";
import CoachTab from "../CoachTab.jsx";
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
      <CoachTab cubeDimension={cubeDimension} practiceSolves={allSolves} competitions={competitions} />
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

function coachVolumeTile() {
  const snapshot = screen.getByText("Evidence Snapshot").closest(".section-card");
  return within(snapshot).getByText("Volume (14d)").closest(".stat-tile").querySelector(".stat-tile-value")
    .textContent;
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

describe("Practice Coach integration", () => {
  it("starts with zero practice volume and updates after a manual backfilled solve", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(coachVolumeTile()).toBe("0 solves");

    await addPastSolve(user, { date: dateInput(1), timeSeconds: "10.00" });
    expect(coachVolumeTile()).toBe("1 solves");
  });

  it("feeds imported csTimer practice solves into the Coach's evidence snapshot", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const secondsAgo = (n) => Math.floor(daysAgo(n) / 1000);
    await importCsTimerData(
      user,
      csTimerExportOf([csTimerEntry(10000, secondsAgo(2)), csTimerEntry(10200, secondsAgo(1))])
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 2 solves"));

    expect(coachVolumeTile()).toBe("2 solves");
  });

  it("feeds imported WCA competition results into the Coach's competition-gap signal", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      { competition_id: "CompA", event_id: "333", round_id: 1, best: 950, average: 1050 },
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue({ name: "Comp A", date: new Date(daysAgo(30)).toISOString() });

    const user = userEvent.setup();
    render(<Harness />);

    const snapshotBefore = screen.getByText("Evidence Snapshot").closest(".section-card");
    expect(within(snapshotBefore).getByText("Competition Gap").closest(".stat-tile")).toHaveTextContent("-");

    await addPastSolve(user, { date: dateInput(36), timeSeconds: "10.00" });
    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Imported 1 new result/));

    const snapshotAfter = screen.getByText("Evidence Snapshot").closest(".section-card");
    expect(within(snapshotAfter).getByText("Competition Gap").closest(".stat-tile")).not.toHaveTextContent("-");
  });

  it("feeds imported csTimer solves into the Coach Review", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const secondsAgo = (n) => Math.floor(daysAgo(n) / 1000);
    const dnfEntry = (timestampSeconds) => [[-1, 0], "R U R' U'", "", timestampSeconds];
    await importCsTimerData(
      user,
      csTimerExportOf([
        dnfEntry(secondsAgo(5)),
        dnfEntry(secondsAgo(4)),
        dnfEntry(secondsAgo(3)),
        csTimerEntry(10000, secondsAgo(2)),
        csTimerEntry(10000, secondsAgo(1)),
      ])
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 5 solves"));

    const review = screen.getByText("Coach Review").closest(".section-card");
    expect(within(review).getByText(/Not enough later data to evaluate Clean up solves/)).toBeInTheDocument();
  });

  it("recomputes for the active event only when switching events", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness cubeDimension="3x3x3" />);

    await addPastSolve(user, { date: dateInput(1), timeSeconds: "10.00" });
    expect(coachVolumeTile()).toBe("1 solves");

    rerender(<Harness cubeDimension="4x4x4" />);
    expect(coachVolumeTile()).toBe("0 solves");
  });
});
