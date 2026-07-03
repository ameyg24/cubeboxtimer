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
      {...props}
    />
  );

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

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/1 conflict/));
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

  it("reports a skipped count when the only results are for unsupported events", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult({ event_id: "333bf" })]);
    const user = userEvent.setup();
    renderImport();

    await user.type(screen.getByRole("textbox", { name: "WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/skipped 1/));
  });
});
