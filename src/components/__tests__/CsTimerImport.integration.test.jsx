// @vitest-environment jsdom
//
// Full integration: SolveList's "Import csTimer solves" modal wired to the
// real useSolveSessions hook (and, for the prediction test, the real
// useCompetitionResults + CompetitionTab too) - mirrors
// PracticeBackfill.integration.test.jsx's approach for the manual "Add past
// solve" flow, but exercises the csTimer import path instead. Confirms the
// imported solves go through the same localStorage-backed persistence and
// the same prediction pipeline as any other practice solve.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSolveSessions } from "../../hooks/useSolveSessions.js";
import { useCompetitionResults } from "../../hooks/useCompetitionResults.js";
import CompetitionTab from "../CompetitionTab.jsx";
import SolveList from "../SolveList.jsx";
import { ThemeProvider } from "../ThemeContext.jsx";
import { useAnalyticsDataset } from "../../hooks/useAnalyticsDataset.js";

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
const secondsAgo = (n) => Math.floor(daysAgo(n) / 1000);

const entry = (penaltyFlag, rawTimeMs, timestampSeconds) => [
  [penaltyFlag, rawTimeMs],
  "R U R' U'",
  "",
  timestampSeconds,
];
const exportOf = (entries) => JSON.stringify({ session1: entries });

function SolveListHarness({ cubeDimension = "3x3x3" }) {
  const { eventSolves, addSolve, updateSolve, deleteSolve, sessions, hydrated } = useSolveSessions({
    user: null,
    cubeDimension,
  });
  return (
    <>
      {hydrated && <span data-testid="hydrated" hidden />}
      <SolveList
        solves={eventSolves}
        updateSolve={updateSolve}
        deleteSolve={deleteSolve}
        addSolve={addSolve}
        cubeDimension={cubeDimension}
        sessions={sessions}
      />
    </>
  );
}

function PredictionHarness({ cubeDimension = "3x3x3" }) {
  const { eventSolves, allSolves, addSolve, updateSolve, deleteSolve, sessions, hydrated: solvesHydrated } = useSolveSessions({
    user: null,
    cubeDimension,
  });
  const { competitions, hydrated: competitionsHydrated, addCompetitionResult, updateCompetitionResult, deleteCompetitionResult } =
    useCompetitionResults({ user: null });
  useAnalyticsDataset({ sessions, competitions, ready: solvesHydrated && competitionsHydrated });
  return (
    <ThemeProvider>
      {solvesHydrated && competitionsHydrated && <span data-testid="hydrated" hidden />}
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

async function importCsTimerData(user, content) {
  await user.click(screen.getByRole("button", { name: /Import csTimer/ }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Or paste export data"), { target: { value: content } });
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
}

// IndexedDB hydration is asynchronous; the harness surfaces a marker once
// the default session exists so tests interact only with hydrated state.
async function renderHydrated(ui) {
  const utils = render(ui);
  await screen.findAllByTestId("hydrated");
  return utils;
}

beforeEach(() => {
  localStorage.clear();
});

describe("csTimer import persistence and prediction integration", () => {
  it("imports solves through addSolve and they survive a reload", async () => {
    const user = userEvent.setup();
    const { unmount } = await renderHydrated(<SolveListHarness />);

    await importCsTimerData(
      user,
      exportOf([entry(0, 10000, secondsAgo(2)), entry(2000, 9500, secondsAgo(3)), entry(-1, 0, secondsAgo(4))])
    );

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 3 solves"));
    expect(screen.getByText("3 total")).toBeInTheDocument();

    unmount();

    await renderHydrated(<SolveListHarness />);
    expect(screen.getByText("3 total")).toBeInTheDocument();
  });

  it("skips every solve as a duplicate when the same export is imported twice", async () => {
    const user = userEvent.setup();
    await renderHydrated(<SolveListHarness />);

    const content = exportOf([entry(0, 10000, secondsAgo(2)), entry(0, 9500, secondsAgo(3))]);
    await importCsTimerData(user, content);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 2 solves"));
    expect(screen.getByText("2 total")).toBeInTheDocument();

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    await user.click(closeButtons[closeButtons.length - 1]);
    await importCsTimerData(user, content);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 0 solves"));
    expect(screen.getByRole("status")).toHaveTextContent("Skipped 2 duplicates");
    expect(screen.getByText("2 total")).toBeInTheDocument();
  });

  it("makes a competition prediction available once imported practice solves land in the 14-day window", async () => {
    const user = userEvent.setup();
    await renderHydrated(<PredictionHarness />);

    const addCompetition = async ({ name, date, average }) => {
      await user.click(screen.getByRole("button", { name: "Add competition" }));
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getByRole("textbox", { name: "Competition Name" }), name);
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: date } });
      await user.type(within(dialog).getByLabelText("Official Average (seconds)"), average);
      await user.click(within(dialog).getByRole("button", { name: "Add" }));
    };
    const dateInput = (n) => new Date(daysAgo(n)).toISOString().slice(0, 10);

    await addCompetition({ name: "First Comp", date: dateInput(90), average: "10.50" });
    await addCompetition({ name: "Second Comp", date: dateInput(60), average: "10.60" });

    expect(screen.getByText(/CubeBox found 2 3x3x3 competitions, but 0 have practice solves/)).toBeInTheDocument();

    // Practice within the 14-day window before each competition, plus
    // recent practice (needed for the live prediction, not just
    // calibration) - all delivered through the csTimer import path.
    await importCsTimerData(
      user,
      exportOf([
        entry(0, 10000, secondsAgo(96)),
        entry(0, 10200, secondsAgo(66)),
        entry(0, 10100, secondsAgo(2)),
      ])
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 3 solves"));

    await waitFor(() => expect(screen.getByText("Predicted Competition Average")).toBeInTheDocument());
    expect(screen.queryByText(/CubeBox found/)).not.toBeInTheDocument();
  });
});
