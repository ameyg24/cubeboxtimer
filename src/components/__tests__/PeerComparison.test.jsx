// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PeerComparison from "../PeerComparison.jsx";

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
  name: "Feliks Zemdegs",
  competition_id: "NewZealandChamps2009",
  event_id: "333",
  round_id: 1,
  best: 1005,
  average: 1374,
  ...overrides,
});

const noPrediction = {
  event: "3x3x3",
  predictedAverageMs: null,
  confidenceRangeMs: null,
  confidenceLevel: "insufficient",
  competitionsUsed: 0,
};

const noBestPrediction = {
  event: "3x3x3",
  predictedBestMs: null,
  confidenceRangeMs: null,
  confidenceLevel: "insufficient",
  competitionsUsed: 0,
};

const yourRealPrediction = {
  event: "3x3x3",
  predictedAverageMs: 10500,
  confidenceRangeMs: [9500, 11500],
  confidenceLevel: "medium",
  competitionsUsed: 3,
};

const yourRealBestPrediction = {
  event: "3x3x3",
  predictedBestMs: 8500,
  confidenceRangeMs: [8000, 9000],
  confidenceLevel: "medium",
  competitionsUsed: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

const renderComparison = (props = {}) =>
  render(
    <PeerComparison
      cubeDimension="3x3x3"
      yourPrediction={noPrediction}
      yourBestPrediction={noBestPrediction}
      {...props}
    />
  );

describe("PeerComparison", () => {
  it("renders a labelled WCA ID field and a Compare button", () => {
    renderComparison();
    expect(screen.getByRole("textbox", { name: "Their WCA ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare" })).toBeInTheDocument();
  });

  it("shows a validation error for an invalid WCA ID without calling the API", async () => {
    const user = userEvent.setup();
    renderComparison();

    await user.type(screen.getByRole("textbox", { name: "Their WCA ID" }), "not-valid");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/valid WCA ID/));
    expect(fetchWcaPersonResults).not.toHaveBeenCalled();
  });

  it("shows side-by-side average and best predictions for you and the other cuber on success", async () => {
    fetchWcaPersonResults.mockResolvedValue([
      rawResult({ round_id: 1, average: 1400, best: 1200 }),
      rawResult({ competition_id: "CompB", round_id: 2, average: 1350, best: 1150 }),
    ]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });
    const user = userEvent.setup();
    renderComparison({ yourPrediction: yourRealPrediction, yourBestPrediction: yourRealBestPrediction });

    await user.type(screen.getByRole("textbox", { name: "Their WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() => expect(screen.getByText("Feliks Zemdegs")).toBeInTheDocument());
    expect(screen.getByText("You")).toBeInTheDocument();
    // Your average (10500ms -> 10.50s) and your best (8500ms -> 8.50s).
    expect(screen.getByText("10.50")).toBeInTheDocument();
    expect(screen.getByText("8.50")).toBeInTheDocument();
    expect(screen.getAllByText("AVERAGE").length).toBe(2);
    expect(screen.getAllByText("BEST SINGLE").length).toBe(2);
    expect(screen.getByText(/Based on their last 2 competitions/)).toBeInTheDocument();
  });

  it("shows the not-enough-history message for your side when you have no prediction yet", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult()]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });
    const user = userEvent.setup();
    renderComparison(); // default noPrediction/noBestPrediction for "you"

    await user.type(screen.getByRole("textbox", { name: "Their WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    // Your average is "not enough history" (0 competitions), and the peer's
    // best-single is also "not enough history" (single result, no trend) -
    // two independent messages, one per metric per side, at minimum.
    await waitFor(() =>
      expect(screen.getAllByText("Not enough history for a prediction.").length).toBeGreaterThanOrEqual(2)
    );
  });

  it("falls back to the WCA ID as the title when the person's name isn't available", async () => {
    fetchWcaPersonResults.mockResolvedValue([rawResult({ name: undefined })]);
    fetchWcaCompetitionMeta.mockResolvedValue({
      name: "New Zealand Championships 2009",
      date: "2009-07-18T00:00:00.000Z",
    });
    const user = userEvent.setup();
    renderComparison();

    await user.type(screen.getByRole("textbox", { name: "Their WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() => expect(screen.getByText("2009ZEMD01")).toBeInTheDocument());
  });

  it("shows a clear error message when the WCA ID doesn't exist", async () => {
    fetchWcaPersonResults.mockRejectedValue(new Error('No WCA competitor found with ID "9999XXXX99".'));
    const user = userEvent.setup();
    renderComparison();

    await user.type(screen.getByRole("textbox", { name: "Their WCA ID" }), "9999XXXX99");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/No WCA competitor found/));
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
    renderComparison();

    await user.type(screen.getByRole("textbox", { name: "Their WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() =>
      expect(screen.getByRole("progressbar", { name: "Comparison progress" })).toBeInTheDocument()
    );

    resolveMeta({ name: "New Zealand Championships 2009", date: "2009-07-18T00:00:00.000Z" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Compare" })).not.toBeDisabled());
  });

  it("disables the Compare button while a request is in flight", async () => {
    let resolveFetch;
    fetchWcaPersonResults.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const user = userEvent.setup();
    renderComparison();

    await user.type(screen.getByRole("textbox", { name: "Their WCA ID" }), "2009ZEMD01");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    expect(screen.getByRole("button", { name: "Comparing…" })).toBeDisabled();
    resolveFetch([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Compare" })).not.toBeDisabled());
  });
});
