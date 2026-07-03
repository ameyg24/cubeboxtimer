// @vitest-environment jsdom
//
// Renders the real App (no signed-in user, so useSolveSessions/
// useCompetitionResults fall back to their localStorage-only path - see
// useSolveSessions.test.jsx). This exercises the actual gate in App.jsx that
// decides whether the Dashboard/CompetitionTab/SolveList tree is reachable
// at all: a brand-new user with zero solves must still be able to reach the
// WCA import form and "Add past solve", not just the live timer.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";

vi.mock("chart.js/auto", () => ({
  default: class MockChart {
    constructor() {
      this.data = { labels: [], datasets: [{ data: [] }, { data: [] }] };
    }
    update() {}
    destroy() {}
  },
}));

beforeEach(() => {
  localStorage.clear();
});

describe("App with zero solves", () => {
  it("still shows the timer-area empty state", () => {
    render(<App />);

    // "No solves yet" appears twice once the Dashboard/SolveList tree is
    // always reachable: once as the timer-area illustration, once as
    // SolveList's own empty state (which carries its own "+ Add past
    // solve" button) - both are expected to coexist.
    expect(screen.getAllByText("No solves yet").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("Your times and statistics will show up here once you finish your first solve.")
    ).toBeInTheDocument();
  });

  it("reaches the Competition tab and WCA import form without having completed a solve", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Competition" }));

    expect(screen.getByText("Import from WCA")).toBeInTheDocument();
    expect(screen.getByLabelText("WCA ID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add competition" })).toBeInTheDocument();
  });

  it("reaches SolveList's own empty state and 'Add past solve' without having completed a solve", async () => {
    const user = userEvent.setup();
    render(<App />);

    const addButtons = screen.getAllByRole("button", { name: "+ Add past solve" });
    expect(addButtons.length).toBeGreaterThan(0);

    await user.click(addButtons[0]);
    expect(screen.getByRole("dialog", { name: "Add Past Solve" })).toBeInTheDocument();
  });
});
