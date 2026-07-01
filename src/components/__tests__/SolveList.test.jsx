// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SolveList from "../SolveList.jsx";

const solve = (id, millis, penalty = null) => ({ id, millis, penalty, cubeDimension: "3x3x3", localCreatedAt: 1 });

// A minimal stand-in for how App actually wires this up: deleteSolve/updateSolve
// mutate real state, so a keyboard delete produces a real re-render with a
// shorter list - exactly the case that used to leave focus pointing nowhere.
function Harness({ initialSolves }) {
  const [solves, setSolves] = useState(initialSolves);
  const deleteSolve = (idx) => setSolves((prev) => prev.filter((_, i) => i !== idx));
  const updateSolve = (idx, patch) =>
    setSolves((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  return <SolveList solves={solves} deleteSolve={deleteSolve} updateSolve={updateSolve} />;
}

describe("SolveList", () => {
  it("shows an empty message with no solves", () => {
    render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} />);
    expect(screen.getByText("No solves yet")).toBeInTheDocument();
  });

  it("reveals the penalty and delete controls for a keyboard-focused row, not just on hover", () => {
    const solves = [solve("a", 10000), solve("b", 11000)];
    render(<SolveList solves={solves} updateSolve={vi.fn()} deleteSolve={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Toggle +2 penalty" })).not.toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Solve history" });
    fireEvent.keyDown(list, { key: "ArrowDown" });

    expect(screen.getByRole("button", { name: "Toggle +2 penalty" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle DNF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete solve" })).toBeInTheDocument();
  });

  it("toggles +2 on the focused solve when its button is clicked", async () => {
    const user = userEvent.setup();
    const updateSolve = vi.fn();
    const solves = [solve("a", 10000), solve("b", 11000)];
    render(<SolveList solves={solves} updateSolve={updateSolve} deleteSolve={vi.fn()} />);

    const list = screen.getByRole("list", { name: "Solve history" });
    fireEvent.keyDown(list, { key: "ArrowDown" }); // focuses the newest solve, index 1 ("b")

    await user.click(screen.getByRole("button", { name: "Toggle +2 penalty" }));
    expect(updateSolve).toHaveBeenCalledWith(1, { penalty: "+2" });
  });

  it("deletes the focused solve on Backspace and moves focus to a neighbor instead of losing it", () => {
    render(<Harness initialSolves={[solve("a", 10000), solve("b", 11000), solve("c", 12000)]} />);

    const list = screen.getByRole("list", { name: "Solve history" });
    fireEvent.keyDown(list, { key: "ArrowDown" }); // focuses "c", the newest solve
    fireEvent.keyDown(list, { key: "Backspace" });

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    // Exactly one row should still show its action controls - the neighbor
    // that took the deleted row's place - rather than focus disappearing.
    const rowsWithActions = rows.filter((row) => within(row).queryByRole("button", { name: "Delete solve" }));
    expect(rowsWithActions).toHaveLength(1);
    expect(rowsWithActions[0]).toHaveTextContent("11.00");
  });

  it("deletes a solve when its delete button is clicked", async () => {
    const user = userEvent.setup();
    const deleteSolve = vi.fn();
    const solves = [solve("a", 10000), solve("b", 11000)];
    render(<SolveList solves={solves} updateSolve={vi.fn()} deleteSolve={deleteSolve} />);

    const list = screen.getByRole("list", { name: "Solve history" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    await user.click(screen.getByRole("button", { name: "Delete solve" }));

    expect(deleteSolve).toHaveBeenCalledWith(1);
  });

  it("undoes the most recent solve from the header button", async () => {
    const user = userEvent.setup();
    const deleteSolve = vi.fn();
    const solves = [solve("a", 10000), solve("b", 11000), solve("c", 12000)];
    render(<SolveList solves={solves} updateSolve={vi.fn()} deleteSolve={deleteSolve} />);

    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(deleteSolve).toHaveBeenCalledWith(2);
  });
});
