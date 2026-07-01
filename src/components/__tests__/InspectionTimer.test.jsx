// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import InspectionTimer from "../InspectionTimer.jsx";

// The interval used to call setState from inside a setRemaining updater,
// which React flags as an update-during-render on another component. These
// tests fast-forward through both penalty thresholds and assert that
// warning never comes back, alongside the actual +2/DNF behavior it guards.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InspectionTimer", () => {
  it("applies a +2 once inspection time runs out, without a render-time state warning", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onPenalty = vi.fn();

    render(<InspectionTimer visible seconds={5} onPenalty={onPenalty} onInspectionEnd={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onPenalty).toHaveBeenCalledWith("+2");
    expect(onPenalty).toHaveBeenCalledTimes(1);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(errorSpy.mock.calls.join(" ")).not.toMatch(/while rendering a different component/);

    errorSpy.mockRestore();
  });

  it("auto-records a DNF and stops ticking once inspection is exceeded by 2 seconds", () => {
    const onPenalty = vi.fn();
    const onInspectionEnd = vi.fn();

    render(<InspectionTimer visible seconds={5} onPenalty={onPenalty} onInspectionEnd={onInspectionEnd} />);

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onPenalty).toHaveBeenLastCalledWith("DNF");
    expect(onInspectionEnd).toHaveBeenCalledWith("DNF");

    // it should have stopped its own interval - advancing further shouldn't
    // call onInspectionEnd again
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onInspectionEnd).toHaveBeenCalledTimes(1);
  });

  it("does not penalize a solve started before the inspection window closes", () => {
    const onPenalty = vi.fn();
    const onInspectionEnd = vi.fn();

    render(<InspectionTimer visible seconds={15} onPenalty={onPenalty} onInspectionEnd={onInspectionEnd} />);

    // Move the clock without letting the interval fire, so this isolates
    // handleStartSolve's own elapsed-time math from the interval's.
    act(() => {
      vi.setSystemTime(Date.now() + 3000);
      screen.getByRole("button", { name: "Start Solve" }).click();
    });

    expect(onPenalty).toHaveBeenCalledWith(null);
    expect(onInspectionEnd).toHaveBeenCalledWith(null);
  });

  it("applies +2 when the solve starts just past the inspection window", () => {
    const onPenalty = vi.fn();
    const onInspectionEnd = vi.fn();

    render(<InspectionTimer visible seconds={15} onPenalty={onPenalty} onInspectionEnd={onInspectionEnd} />);

    act(() => {
      vi.setSystemTime(Date.now() + 16000);
      screen.getByRole("button", { name: "Start Solve" }).click();
    });

    expect(onPenalty).toHaveBeenCalledWith("+2");
    expect(onInspectionEnd).toHaveBeenCalledWith("+2");
  });
});
