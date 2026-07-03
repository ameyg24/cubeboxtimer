// @vitest-environment jsdom
//
// Integration tests: the real useCompetitionResults hook (localStorage-only,
// no signed-in user) wired to the real CompetitionTab component, exactly how
// App.jsx wires them. CompetitionTab.test.jsx covers rendering/validation in
// isolation with mocked callbacks; these tests instead exercise persistence -
// add/edit/delete surviving a reload, and the prediction updating as the
// underlying data changes.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCompetitionResults } from "../../hooks/useCompetitionResults.js";
import CompetitionTab from "../CompetitionTab.jsx";

const STORAGE_KEY = "cubeboxtimer_competitions";
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => Date.now() - n * DAY;

const solve = (daysBack, millis) => ({
  id: `s-${daysBack}-${millis}-${Math.random().toString(36).slice(2)}`,
  millis,
  penalty: null,
  cubeDimension: "3x3x3",
  localCreatedAt: daysAgo(daysBack),
});

function Harness({ practiceSolves = [], cubeDimension = "3x3x3" }) {
  const { competitions, addCompetitionResult, updateCompetitionResult, deleteCompetitionResult } =
    useCompetitionResults({ user: null });
  return (
    <CompetitionTab
      cubeDimension={cubeDimension}
      practiceSolves={practiceSolves}
      competitions={competitions}
      addCompetitionResult={addCompetitionResult}
      updateCompetitionResult={updateCompetitionResult}
      deleteCompetitionResult={deleteCompetitionResult}
    />
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

beforeEach(() => {
  localStorage.clear();
});

describe("CompetitionTab wired to useCompetitionResults", () => {
  it("shows the no-history empty state before anything is entered", () => {
    render(<Harness />);
    expect(screen.getByText("No competition history yet.")).toBeInTheDocument();
  });

  it("adds a competition through the form and persists it to localStorage", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Tokyo Open")).toBeInTheDocument();

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].competitionName).toBe("Tokyo Open");
    expect(persisted[0].averageMs).toBe(13200);
  });

  it("shows the more-history-needed message after exactly one competition is added", async () => {
    const user = userEvent.setup();
    render(<Harness practiceSolves={[solve(5, 10000), solve(2, 10000)]} />);

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
    render(<Harness practiceSolves={practiceSolves} />);

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
    render(<Harness />);

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
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(persisted[0].competitionName).toBe("Tokyo Open 2026");
  });

  it("deletes a competition and it disappears from the list and localStorage", async () => {
    const user = userEvent.setup();
    render(<Harness />);

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
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(persisted).toHaveLength(0);
  });

  it("survives a reload: unmounting and remounting rehydrates from localStorage", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    await fillAndSubmit(user, screen.getByRole("dialog"), {
      name: "Tokyo Open",
      date: "2026-03-01",
      average: "13.20",
    });
    unmount();

    render(<Harness />);
    expect(screen.getByText("Tokyo Open")).toBeInTheDocument();
  });

  it("does not show a competition entered for a different event", async () => {
    const user = userEvent.setup();
    render(<Harness cubeDimension="3x3x3" />);

    await user.click(screen.getByRole("button", { name: "Add competition" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Event"), "2x2x2");
    await fillAndSubmit(user, dialog, { name: "2x2 Comp", date: "2026-03-01", average: "3.20" });

    expect(screen.getByText("No competition history yet.")).toBeInTheDocument();
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(persisted[0].event).toBe("2x2x2");
  });
});
