// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../Modal.jsx";

// Every dialog in the app (settings, profile, shortcuts) is this same shell,
// so testing it directly covers all three without needing to render the
// whole app and its Firebase/timer machinery.
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open settings</button>
      {open && (
        <Modal titleId="test-title" onClose={() => setOpen(false)}>
          <h2 id="test-title">Test dialog</h2>
          <input aria-label="Some field" />
        </Modal>
      )}
    </div>
  );
}

describe("Modal", () => {
  it("moves focus inside itself when it opens", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("is labelled and marked modal for assistive tech", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Test dialog");
  });

  it("traps Tab so it cycles within the dialog instead of escaping to the page", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const closeButton = screen.getByRole("button", { name: "Close" });
    const field = screen.getByRole("textbox", { name: "Some field" });

    expect(document.activeElement).toBe(closeButton);
    await user.tab();
    expect(document.activeElement).toBe(field);
    await user.tab();
    expect(document.activeElement).toBe(closeButton);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(field);
  });

  it("closes on Escape and returns focus to whatever opened it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open settings" });

    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("closes when the overlay itself is clicked, but not when the dialog content is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));

    await user.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const overlay = screen.getByRole("dialog").parentElement;
    await user.click(overlay);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
