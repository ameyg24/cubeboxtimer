// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CollapsibleSection from "../CollapsibleSection.jsx";

describe("CollapsibleSection", () => {
  it("shows its content by default", () => {
    render(
      <CollapsibleSection title="Competition Results">
        <div>the content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText("Competition Results")).toBeInTheDocument();
    expect(screen.getByText("the content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Competition Results/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("hides its content when defaultOpen is false", () => {
    render(
      <CollapsibleSection title="Competition Results" defaultOpen={false}>
        <div>the content</div>
      </CollapsibleSection>
    );
    expect(screen.queryByText("the content")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Competition Results/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles content visibility when the header is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Competition Results">
        <div>the content</div>
      </CollapsibleSection>
    );

    const toggle = screen.getByRole("button", { name: /Competition Results/ });
    await user.click(toggle);
    expect(screen.queryByText("the content")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByText("the content")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders header actions regardless of open/closed state", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Competition Results" actions={<button>Add competition</button>}>
        <div>the content</div>
      </CollapsibleSection>
    );

    expect(screen.getByRole("button", { name: "Add competition" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Competition Results/ }));
    expect(screen.getByRole("button", { name: "Add competition" })).toBeInTheDocument();
  });
});
