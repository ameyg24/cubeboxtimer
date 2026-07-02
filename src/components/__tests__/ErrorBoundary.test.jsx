// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary, { ErrorFallback } from "../ErrorBoundary.jsx";

// React logs caught render errors to console.error; keep test output clean
// without hiding assertions on what actually got logged.
let errorSpy;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

function Bomb({ control }) {
  if (control.shouldThrow) throw new Error("boom");
  return <div>Recovered content</div>;
}

describe("ErrorBoundary", () => {
  it("renders the fallback instead of crashing when a child throws during render", () => {
    render(
      <ErrorBoundary fallback={() => <div role="alert">Fallback UI</div>}>
        <Bomb control={{ shouldThrow: true }} />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Fallback UI");
    expect(screen.queryByText("Recovered content")).not.toBeInTheDocument();
  });

  it("restores the child once retry is triggered and the underlying problem is gone", async () => {
    const user = userEvent.setup();
    const control = { shouldThrow: true };

    render(
      <ErrorBoundary fallback={(retry) => <button onClick={retry}>Try again</button>}>
        <Bomb control={control} />
      </ErrorBoundary>
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    control.shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("does not take down content rendered outside the boundary", () => {
    render(
      <div>
        <span>Sibling content</span>
        <ErrorBoundary fallback={() => <div role="alert">Panel crashed</div>}>
          <Bomb control={{ shouldThrow: true }} />
        </ErrorBoundary>
      </div>
    );

    expect(screen.getByText("Sibling content")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Panel crashed");
  });
});

describe("ErrorFallback", () => {
  it("has accessible alert semantics and calls onRetry when clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<ErrorFallback title="Broken" message="It broke." onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Broken");
    expect(alert).toHaveTextContent("It broke.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders an optional secondary action alongside retry", async () => {
    const user = userEvent.setup();
    const onSecondary = vi.fn();

    render(
      <ErrorFallback
        title="Broken"
        message="It broke."
        onRetry={vi.fn()}
        secondaryAction={{ label: "Reload page", onClick: onSecondary }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Reload page" }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });
});
