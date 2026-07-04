// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CsTimerImportModal from "../CsTimerImport.jsx";

const entry = (penaltyFlag, rawTimeMs, timestampSeconds = 1700000000) => [
  [penaltyFlag, rawTimeMs],
  "R U R' U'",
  "",
  timestampSeconds,
];
const exportOf = (entries) => JSON.stringify({ session1: entries });

beforeEach(() => {
  vi.clearAllMocks();
});

const renderModal = (props = {}) =>
  render(
    <CsTimerImportModal
      titleId="cstimer-import-title"
      defaultDimension="3x3x3"
      getExistingSolvesForDimension={() => []}
      addSolve={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );

// The textarea holds raw JSON (full of {}/[] characters), which
// userEvent.type() would otherwise interpret as special key sequences -
// fireEvent.change sets the value directly, same as the date/select
// fields in WcaImport.test.jsx and CompetitionTab.test.jsx do.
const pasteExport = (value) => {
  fireEvent.change(screen.getByLabelText("Or paste export data"), { target: { value } });
};

describe("CsTimerImportModal", () => {
  it("renders an event selector, a paste field, a file upload, and an Import button", () => {
    renderModal();
    expect(screen.getByRole("combobox", { name: "Event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Or paste export data")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload export file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });

  it("defaults the event selector to the currently active cube dimension", () => {
    renderModal({ defaultDimension: "4x4x4" });
    expect(screen.getByRole("combobox", { name: "Event" })).toHaveValue("4x4x4");
  });

  it("imports pasted csTimer data through addSolve and shows a summary", async () => {
    const addSolve = vi.fn();
    const user = userEvent.setup();
    renderModal({ addSolve });

    pasteExport(exportOf([entry(0, 10000), entry(2000, 9500), entry(-1, 0)]));
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 3 solves"));
    expect(addSolve).toHaveBeenCalledTimes(3);
  });

  it("shows a parse error and does not call addSolve for garbage input", async () => {
    const addSolve = vi.fn();
    const user = userEvent.setup();
    renderModal({ addSolve });

    pasteExport("not valid json");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Could not parse/));
    expect(addSolve).not.toHaveBeenCalled();
  });

  it("reports duplicates using the existing solves provided for the chosen dimension", async () => {
    const addSolve = vi.fn();
    const getExistingSolvesForDimension = vi.fn(() => [
      { millis: 10000, penalty: null, localCreatedAt: 1700000000000 },
    ]);
    const user = userEvent.setup();
    renderModal({ addSolve, getExistingSolvesForDimension });

    pasteExport(exportOf([entry(0, 10000), entry(0, 9500)]));
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 1 solve"));
    expect(screen.getByRole("status")).toHaveTextContent("Skipped 1 duplicate");
    expect(addSolve).toHaveBeenCalledTimes(1);
  });

  it("fills the paste field from an uploaded file", async () => {
    const user = userEvent.setup();
    renderModal();

    const content = exportOf([entry(0, 10000)]);
    const file = new File([content], "cstimer_export.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Upload export file"), file);

    await waitFor(() => expect(screen.getByLabelText("Or paste export data")).toHaveValue(content));
  });

  it("closes the modal when Close is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onClose });
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    await user.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });
});
