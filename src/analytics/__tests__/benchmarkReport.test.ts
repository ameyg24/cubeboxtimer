import { describe, it, expect } from "vitest";
import { renderBenchmarkReport } from "../benchmarkReport";
import { MODEL_LABELS } from "../modelComparison";
import { buildSampleData, SAMPLE_DATA_LABEL, SAMPLE_EVENT } from "../../../scripts/benchmarkData";

const sampleInput = () => {
  const { solves, competitionResults } = buildSampleData();
  return { event: SAMPLE_EVENT, solves, competitionResults, dataLabel: SAMPLE_DATA_LABEL };
};

describe("renderBenchmarkReport", () => {
  it("labels the data source prominently so sample output can't pass as real results", () => {
    const report = renderBenchmarkReport(sampleInput());
    expect(report).toContain("SAMPLE DATA");
    expect(report.indexOf("SAMPLE DATA")).toBeLessThan(report.indexOf("DATASET"));
  });

  it("contains every section", () => {
    const report = renderBenchmarkReport(sampleInput());
    for (const section of [
      "DATASET",
      "MODEL COMPARISON (walk-forward)",
      "CALIBRATION",
      "FEATURE ABLATION",
      "EXPLANATIONS",
      "ERROR NOTES",
    ]) {
      expect(report).toContain(section);
    }
  });

  it("lists all six model labels", () => {
    const report = renderBenchmarkReport(sampleInput());
    for (const label of Object.values(MODEL_LABELS)) {
      expect(report).toContain(label);
    }
  });

  it("contains no wall-clock output — identical input renders identical text", () => {
    expect(renderBenchmarkReport(sampleInput())).toBe(renderBenchmarkReport(sampleInput()));
  });

  it("renders the honest empty state for no data at all", () => {
    const report = renderBenchmarkReport({
      event: "3x3x3",
      solves: [],
      competitionResults: [],
      dataLabel: SAMPLE_DATA_LABEL,
    });
    expect(report).toContain("no intervals to evaluate");
    expect(report).toContain("no walk-forward case to explain");
    expect(report).toContain("no flags");
  });

  it("the sample fixture itself is deterministic", () => {
    expect(buildSampleData()).toEqual(buildSampleData());
  });
});
