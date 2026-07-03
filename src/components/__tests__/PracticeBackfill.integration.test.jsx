// @vitest-environment jsdom
//
// Full integration: SolveList and CompetitionTab wired to the real
// useSolveSessions/useCompetitionResults hooks together, mirroring exactly
// how App.jsx composes them (both consume the same practiceSolves =
// allSolves for the active event). CompetitionTab.integration.test.jsx
// already covers useCompetitionResults on its own with a static
// practiceSolves prop; this file exercises the actual "Add past solve" UI
// as the thing that produces that practice data, since that's the whole
// point of backfilling - a competition result alone can't produce a
// prediction without practice solves near its date.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSolveSessions } from "../../hooks/useSolveSessions.js";
import { useCompetitionResults } from "../../hooks/useCompetitionResults.js";
import CompetitionTab from "../CompetitionTab.jsx";
import SolveList from "../SolveList.jsx";
import { ThemeProvider } from "../ThemeContext.jsx";

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
const dateInput = (n) => new Date(daysAgo(n)).toISOString().slice(0, 10);

function Harness({ cubeDimension = "3x3x3" }) {
  const { eventSolves, allSolves, addSolve, updateSolve, deleteSolve } = useSolveSessions({
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

async function addPastSolve(user, { date, event, timeSeconds, penalty }) {
  await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
  const dialog = screen.getByRole("dialog");
  if (event !== undefined) {
    fireEvent.change(within(dialog).getByLabelText("Event"), { target: { value: event } });
  }
  fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: date } });
  if (penalty !== undefined) {
    fireEvent.change(within(dialog).getByLabelText(/Penalty/), { target: { value: penalty } });
  }
  if (timeSeconds !== undefined) {
    await user.type(within(dialog).getByLabelText(/Time \(seconds\)/), timeSeconds);
  }
  await user.click(within(dialog).getByRole("button", { name: "Add" }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("Backfilling practice solves feeds the prediction and historical calibration", () => {
  it("shows the insufficient-practice-match empty state for two competitions with no nearby practice", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addCompetition(user, { name: "First Comp", date: dateInput(90), average: "10.50" });
    await addCompetition(user, { name: "Second Comp", date: dateInput(60), average: "10.60" });

    expect(screen.getByText(/CubeBox found 2 3x3x3 competitions, but 0 have practice solves/)).toBeInTheDocument();
    expect(screen.getByText(/Historical calibration needs a competition result and practice solves/)).toBeInTheDocument();
  });

  it("becomes a real prediction after backfilling practice solves near both competitions and recent practice", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addCompetition(user, { name: "First Comp", date: dateInput(90), average: "10.50" });
    await addCompetition(user, { name: "Second Comp", date: dateInput(60), average: "10.60" });

    // Practice within the 14-day window before each competition date.
    await addPastSolve(user, { date: dateInput(96), timeSeconds: "10.00" });
    await addPastSolve(user, { date: dateInput(66), timeSeconds: "10.20" });
    // Recent practice (last 14 days from "now") - needed for the live
    // prediction itself, not just the historical calibration comparisons.
    await addPastSolve(user, { date: dateInput(2), timeSeconds: "10.10" });

    await waitFor(() => expect(screen.getByText("Predicted Competition Average")).toBeInTheDocument());
    expect(screen.queryByText(/CubeBox found/)).not.toBeInTheDocument();

    // Historical calibration now has two comparable competitions.
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows.some((r) => within(r).queryByText("First Comp"))).toBe(true);
    expect(rows.some((r) => within(r).queryByText("Second Comp"))).toBe(true);
  });

  it("historical calibration alone becomes available with just the backfilled comparisons, even without recent practice", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addCompetition(user, { name: "First Comp", date: dateInput(90), average: "10.50" });
    await addCompetition(user, { name: "Second Comp", date: dateInput(60), average: "10.60" });
    await addPastSolve(user, { date: dateInput(96), timeSeconds: "10.00" });
    await addPastSolve(user, { date: dateInput(66), timeSeconds: "10.20" });

    expect(screen.queryByText(/Historical calibration needs a competition result/)).not.toBeInTheDocument();
    const calibrationTable = screen.getByRole("table", { name: "Historical calibration" });
    expect(within(calibrationTable).getByText("First Comp")).toBeInTheDocument();
    expect(within(calibrationTable).getByText("Second Comp")).toBeInTheDocument();
  });

  it("a manually backfilled DNF solve is excluded from the practice average like any other DNF", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addPastSolve(user, { date: dateInput(2), penalty: "DNF" });

    // The solve's time display and its penalty badge both read "DNF".
    expect(screen.getAllByText("DNF").length).toBeGreaterThanOrEqual(2);
    // A DNF-only solve list has no valid time, so BEST/MEAN stay blank
    // rather than showing a fabricated 0.00s.
    expect(screen.queryByText("0.00s")).not.toBeInTheDocument();
  });

  it("a manually backfilled +2 solve applies the penalty through the existing effectiveMillis display, not a stored raw+2000 value", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addPastSolve(user, { date: dateInput(2), timeSeconds: "10.00", penalty: "+2" });

    // 10.00s raw + 2s penalty = 12.00s displayed.
    expect(screen.getByText("12.00+")).toBeInTheDocument();
  });

  it("backfills a solve into a different event than the one currently active", async () => {
    const user = userEvent.setup();
    render(<Harness cubeDimension="3x3x3" />);

    await addPastSolve(user, { date: dateInput(2), event: "4x4x4", timeSeconds: "45.00" });

    // Not shown under the active 3x3x3 event...
    expect(screen.getByText("No solves yet")).toBeInTheDocument();
  });

  it("deleting a backfilled solve removes it and updates the solve count", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await addPastSolve(user, { date: dateInput(2), timeSeconds: "10.00" });
    expect(screen.getByText("1 total")).toBeInTheDocument();

    // fireEvent.click (not userEvent.click) deliberately: userEvent's
    // realistic pointer simulation fires a real mouseenter first, which
    // would itself reveal the full hover action bar and swap out this
    // always-visible compact button - a bare click, with no hover at all,
    // is exactly the discoverability case this button exists for.
    fireEvent.click(screen.getByRole("button", { name: "Delete solve 1" }));

    expect(screen.getByText("No solves yet")).toBeInTheDocument();
  });

  it("survives a reload", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await addCompetition(user, { name: "First Comp", date: dateInput(90), average: "10.50" });
    await addCompetition(user, { name: "Second Comp", date: dateInput(60), average: "10.60" });
    await addPastSolve(user, { date: dateInput(96), timeSeconds: "10.00" });
    await addPastSolve(user, { date: dateInput(66), timeSeconds: "10.20" });
    await addPastSolve(user, { date: dateInput(2), timeSeconds: "10.10" });
    await waitFor(() => expect(screen.getByText("Predicted Competition Average")).toBeInTheDocument());
    unmount();

    render(<Harness />);
    await waitFor(() => expect(screen.getByText("Predicted Competition Average")).toBeInTheDocument());
    expect(screen.getByText("3 total")).toBeInTheDocument();
  });
});
