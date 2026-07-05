// @vitest-environment jsdom
//
// Drives CoachTab directly with in-memory solves/competitions (no
// persistence layer), mirroring CompetitionTab.test.jsx. See
// CoachTab.integration.test.jsx for the real hooks wired in.
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CoachTab from "../CoachTab.jsx";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => Date.now() - n * DAY;

const solve = (daysBack, millis, penalty = null) => ({
  id: `s-${daysBack}-${millis}-${Math.random().toString(36).slice(2)}`,
  millis,
  penalty,
  localCreatedAt: daysAgo(daysBack),
});

const competition = (id, daysBack, averageMs) => ({
  id,
  competitionName: `Competition ${id}`,
  date: new Date(daysAgo(daysBack)).toISOString(),
  event: "3x3x3",
  averageMs,
  bestMs: null,
  source: "manual",
});

// 2 competitions with matching practice, plus solves in both adjacent
// 7-day momentum windows, plus a recent single PB (day2, 9000ms) - has
// every underlying signal defined (no null-driven limitation), so
// Limitations never renders here.
const healthyFixture = () => ({
  practiceSolves: [
    solve(100, 10000), solve(96, 10000),
    solve(70, 10000), solve(66, 10000),
    solve(10, 10500),
    solve(5, 10000), solve(2, 9000),
  ],
  competitions: [competition("c1", 90, 10500), competition("c2", 60, 10600)],
});

const highDnfFixture = () => ({
  practiceSolves: [
    solve(5, 0, "DNF"), solve(4, 0, "DNF"), solve(3, 0, "DNF"),
    solve(2, 10000), solve(1, 10000),
  ],
  competitions: [],
});

describe("CoachTab", () => {
  it("renders a readiness score and label with no data at all", () => {
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={[]} competitions={[]} />);
    expect(screen.getByText("Coach Summary")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Mixed")).toBeInTheDocument();
  });

  it("flags Build recent volume as the only focus area with zero practice", () => {
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={[]} competitions={[]} />);
    const focusHeading = screen.getByText("Top Focus Areas").parentElement;
    expect(within(focusHeading).getByText("Build recent volume")).toBeInTheDocument();
  });

  it("shows Limitations with no data at all", () => {
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={[]} competitions={[]} />);
    expect(screen.getByText("Limitations")).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("hides Limitations once every underlying signal is defined", () => {
    const { practiceSolves, competitions } = healthyFixture();
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={practiceSolves} competitions={competitions} />);
    expect(screen.queryByText("Limitations")).not.toBeInTheDocument();
  });

  it("renders a focus area card with priority, evidence, drill, and target", () => {
    const { practiceSolves, competitions } = highDnfFixture();
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={practiceSolves} competitions={competitions} />);

    const card = screen.getByText("Clean up solves").closest(".section-card");
    expect(within(card).getByText("DNF rate is above target.")).toBeInTheDocument();
    expect(within(card).getByText("60.0%")).toBeInTheDocument(); // 3 DNFs of 5 solves
    expect(within(card).getByText(/Run 3 blocks of 20 solves where a DNF ends the block/)).toBeInTheDocument();
    expect(within(card).getByText(/DNF rate under 10%/)).toBeInTheDocument();
  });

  it("renders the Evidence Snapshot with the same DNF rate as the focus area evidence", () => {
    const { practiceSolves, competitions } = highDnfFixture();
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={practiceSolves} competitions={competitions} />);

    const snapshot = screen.getByText("Evidence Snapshot").closest(".section-card");
    expect(within(snapshot).getByText("60.0%")).toBeInTheDocument();
    expect(within(snapshot).getByText("5 solves")).toBeInTheDocument();
  });

  it("shows a dash in the Evidence Snapshot for signals with no data", () => {
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={[]} competitions={[]} />);
    const snapshot = screen.getByText("Evidence Snapshot").closest(".section-card");
    expect(within(snapshot).getAllByText("-").length).toBeGreaterThan(0);
  });

  it("conveys priority through visible text, not color alone", () => {
    const { practiceSolves, competitions } = highDnfFixture();
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={practiceSolves} competitions={competitions} />);
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("renders Limitations as a semantic list", () => {
    render(<CoachTab cubeDimension="3x3x3" practiceSolves={[]} competitions={[]} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    within(list)
      .getAllByRole("listitem")
      .forEach((item) => expect(item.tagName).toBe("LI"));
  });

  it("scopes to the active event only", () => {
    const fourByFourSolves = [solve(5, 40000), solve(2, 40000)];
    render(<CoachTab cubeDimension="4x4x4" practiceSolves={fourByFourSolves} competitions={[]} />);
    const snapshot = screen.getByText("Evidence Snapshot").closest(".section-card");
    expect(within(snapshot).getByText("2 solves")).toBeInTheDocument();
  });
});
