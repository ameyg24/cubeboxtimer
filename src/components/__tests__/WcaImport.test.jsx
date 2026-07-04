// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WcaImport from "../WcaImport.jsx";

vi.mock("../../hooks/wcaApi.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchWcaPersonResults: vi.fn(),
    fetchWcaCompetitionMeta: vi.fn(),
  };
});

import { fetchWcaCompetitionMeta, fetchWcaPersonResults } from "../../hooks/wcaApi.js";

const rawResult = (overrides = {}) => ({
  competition_id: "NewZealandChamps2009",
  event_id: "333",
  round_id: 1,
  best: 1005,
  average: 1374,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

const renderImport = (props = {}) =>
  render(
    <WcaImport
      competitions={[]}
      addCompetitionResult={vi.fn()}
      updateCompetitionResult={vi.fn()}
      deleteCompetitionResult={vi.fn()}
      {...props}
    />
  );

const importedResult = (overrides = {}) => ({
  id: "imported-1",
  competitionName: "New Zealand Championships 2009",
  date: "2009-07-18T00:00:00.000Z",
  event: "3x3x3",
  averageMs: 13740,
  bestMs: 10050,
  source: "wca-import",
  wcaCompetitionId: "NewZealandChamps2009",
  wcaId: "2009ZEMD01",
  ...overrides,
});

describe("WcaImport", () => {
  it("renders a labelled WCA ID field and an Import button", () => {
    renderImport();
    expect(screen.getByRole("textbox", { name: "WCA ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });

  it("shows a validation error for an invalid WCA ID without calling the API", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "not-valid");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/valid WCA ID/));
    expect(fetchWcaPersonResults).not.toHaveBeenCalled();
  });

  it("shows an import summary on success", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });
    const addCompetitionResult = vi.fn();
    const user = userEvent.setup();
    renderImport({ addCompetitionResult });

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Imported 1 new result/));
    expect(addCompetitionResult).toHaveBeenCalled();
  });

  it("shows a clear error message when the WCA ID doesn't exist", async () => {
    fetchWcaPersonResults.mockRejectedValue(new Error('No WCA competitor found with ID "9999XXXX99".'));
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "9999XXXX99");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/No WCA competitor found/));
  });

  it("disables the Import button while a request is in flight", async () => {
    let resolveFetch;
    fetchWcaPersonResults.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    resolveFetch([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).not.toBeDisabled());
  });

  it("lists conflicts in the summary when a manual record has different values for the same event/date", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });
    const existing = [
      {
        id: "manual-1",
        competitionName: "New Zealand Championships 2009",
        date: "2009-07-18T00:00:00.000Z",
        event: "3x3x3",
        averageMs: 15000,
        bestMs: 12000,
        source: "manual",
      },
    ];
    const user = userEvent.setup();
    renderImport({ competitions: existing });

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Conflicts: 1/));
    expect(screen.getByRole("status")).toHaveTextContent("New Zealand Championships 2009");
  });

  it("reports when the WCA ID has no results at all", async () => {
    fetchWcaPersonResults.mockResolvedValue([]);
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/No 2x2x2–5x5x5 results found/)
    );
  });

  it("reports a per-category skip breakdown instead of one opaque count", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult({ event_id: "333bf" })]);
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Skipped 1 unsupported event/));
  });

  it("shows a full import breakdown covering every non-zero category", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      rawResult({ competition_id: "CompA", event_id: "333" }),
      rawResult({ competition_id: "CompB", event_id: "333bf" }),
      rawResult({ competition_id: "CompC", event_id: "333", average: -1 }),
      rawResult({ competition_id: "CompD", event_id: "333", average: 0 }),
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    const status = await waitFor(() => screen.getByRole("status"));
    await waitFor(() => expect(status).toHaveTextContent(/Imported 1 new result/));
    expect(status).toHaveTextContent(/Skipped 1 unsupported event/);
    expect(status).toHaveTextContent(/Skipped 2 missing\/invalid averages/);
    // Zero categories - updated, duplicates, conflicts - don't clutter the summary.
    expect(status).not.toHaveTextContent(/Updated/);
    expect(status).not.toHaveTextContent(/duplicate/);
    expect(status).not.toHaveTextContent(/Conflicts/);
  });

  it("shows the every-round import policy near the import form", () => {
    renderImport();
    expect(
      screen.getByText(/imports every round you competed in/)
    ).toBeInTheDocument();
  });

  it("shows a progress bar while checking competition metadata", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    let resolveMeta;
    fetchWcaCompetitionMeta.mockReturnValue(
      new Promise((resolve) => {
        resolveMeta = resolve;
      })
    );
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByRole("progressbar", { name: "Import progress" })).toBeInTheDocument()
    );
    expect(screen.getByText(/Checking competition details… 0 of 1/)).toBeInTheDocument();

    resolveMeta({ name: "New Zealand Championships 2009", date: "2009-07-18T00:00:00.000Z" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).not.toBeDisabled());
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("does not show a bulk-delete control or the WCA ID lock when nothing has been imported yet", () => {
    renderImport();
    expect(screen.getByRole("textbox", { name: "WCA ID" })).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Delete all imported results/ })).not.toBeInTheDocument();
  });

  it("locks the WCA ID field to the already-imported ID and runs the import with it directly", async () => {
    fetchWcaPersonResults.mockResolvedValue([]);
    const user = userEvent.setup();
    renderImport({ competitions: [importedResult()] });

    const input = screen.getByRole("textbox", { name: "WCA ID" });
    expect(input).toHaveValue("2009ZEMD01");
    expect(input).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(fetchWcaPersonResults).toHaveBeenCalledWith("2009ZEMD01"));
  });

  it("shows a bulk-delete control with the imported count once results have been imported", () => {
    renderImport({ competitions: [importedResult({ id: "a" }), importedResult({ id: "b" })] });
    expect(screen.getByText(/2 imported results across all events/)).toBeInTheDocument();
  });

  it("requires a second click to actually delete every imported result, unlinking the WCA ID", async () => {
    const deleteCompetitionResult = vi.fn();
    const user = userEvent.setup();
    renderImport({
      competitions: [importedResult({ id: "a" }), importedResult({ id: "b" })],
      deleteCompetitionResult,
    });

    const deleteButton = screen.getByRole("button", { name: "Delete all imported results" });
    await user.click(deleteButton);
    expect(deleteCompetitionResult).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/removes all 2 imported results/);

    await user.click(screen.getByRole("button", { name: "Click again to permanently delete" }));
    expect(deleteCompetitionResult).toHaveBeenCalledWith("a");
    expect(deleteCompetitionResult).toHaveBeenCalledWith("b");
    expect(deleteCompetitionResult).toHaveBeenCalledTimes(2);
  });
});
