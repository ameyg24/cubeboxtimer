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

  it("shows a delete button for every row without requiring hover or keyboard focus first", () => {
    const solves = [solve("a", 10000), solve("b", 11000), solve("c", 12000)];
    render(<SolveList solves={solves} updateSolve={vi.fn()} deleteSolve={vi.fn()} />);

    // Touch devices have no hover state, so a delete control that only
    // appears on hover/focus would be unreachable there - every row must
    // have one available from the start.
    expect(screen.getByRole("button", { name: "Delete solve 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete solve 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete solve 3" })).toBeInTheDocument();
  });

  it("deletes via the always-visible per-row delete button with a bare click, no hover needed", () => {
    render(<Harness initialSolves={[solve("a", 10000), solve("b", 11000)]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete solve 2" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("10.00")).toBeInTheDocument();
  });

  describe("Add past solve", () => {
    it("does not show an add-solve button when addSolve isn't provided", () => {
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "+ Add past solve" })).not.toBeInTheDocument();
    });

    it("is reachable from the empty state, not just the populated list", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="3x3x3" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      expect(screen.getByRole("dialog")).toHaveAccessibleName("Add Past Solve");
    });

    it("requires a date and a time before submitting", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="3x3x3" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      expect(within(dialog).getByText("Date is required.")).toHaveAttribute("role", "alert");
      expect(within(dialog).getByText("Time is required.")).toHaveAttribute("role", "alert");
      expect(addSolve).not.toHaveBeenCalled();
    });

    it("rejects a non-positive time as an impossible value", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="3x3x3" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2024-05-01" } });
      await user.type(within(dialog).getByLabelText(/Time \(seconds\)/), "-5");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      expect(within(dialog).getByText("Enter a realistic time, in seconds.")).toHaveAttribute("role", "alert");
      expect(addSolve).not.toHaveBeenCalled();
    });

    it("adds a past solve with the chosen date, event, and penalty, defaulting the event to the active cube dimension", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="4x4x4" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Event")).toHaveValue("4x4x4");
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2024-05-01" } });
      await user.type(within(dialog).getByLabelText(/Time \(seconds\)/), "45.50");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      expect(addSolve).toHaveBeenCalledTimes(1);
      const [solveObj, dimension] = addSolve.mock.calls[0];
      expect(dimension).toBe("4x4x4");
      expect(solveObj).toMatchObject({
        millis: 45500,
        penalty: null,
        cubeDimension: "4x4x4",
      });
      expect(solveObj.localCreatedAt).toBe(new Date("2024-05-01").getTime());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("lets the event be changed away from the currently active cube dimension", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="3x3x3" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Event"), { target: { value: "2x2x2" } });
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2024-05-01" } });
      await user.type(within(dialog).getByLabelText(/Time \(seconds\)/), "3.50");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      const [, dimension] = addSolve.mock.calls[0];
      expect(dimension).toBe("2x2x2");
    });

    it("disables and does not require the time field for a DNF, and stores millis: 0", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="3x3x3" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2024-05-01" } });
      fireEvent.change(within(dialog).getByLabelText(/Penalty/), { target: { value: "DNF" } });
      expect(within(dialog).getByLabelText(/Time \(seconds\)/)).toBeDisabled();
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      expect(addSolve).toHaveBeenCalledTimes(1);
      const [solveObj] = addSolve.mock.calls[0];
      expect(solveObj.penalty).toBe("DNF");
      expect(solveObj.millis).toBe(0);
    });

    it("stores the raw time for a +2 without adding the 2000ms penalty (applied later by effectiveMillis)", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="3x3x3" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2024-05-01" } });
      fireEvent.change(within(dialog).getByLabelText(/Penalty/), { target: { value: "+2" } });
      await user.type(within(dialog).getByLabelText(/Time \(seconds\)/), "10.00");
      await user.click(within(dialog).getByRole("button", { name: "Add" }));

      const [solveObj] = addSolve.mock.calls[0];
      expect(solveObj.penalty).toBe("+2");
      expect(solveObj.millis).toBe(10000); // raw, not 12000 - the +2 is applied at read time
    });

    it("closes without adding a solve on Cancel", async () => {
      const user = userEvent.setup();
      const addSolve = vi.fn();
      render(<SolveList solves={[]} updateSolve={vi.fn()} deleteSolve={vi.fn()} addSolve={addSolve} cubeDimension="3x3x3" />);

      await user.click(screen.getByRole("button", { name: "+ Add past solve" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(addSolve).not.toHaveBeenCalled();
    });
  });
});
