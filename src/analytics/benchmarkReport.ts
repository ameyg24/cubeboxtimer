// CubeBox analytics — benchmark report (pure).
//
// Renders the full evaluation pipeline — dataset, model comparison,
// calibration, ablation, explanations, error notes — as one plain-text
// report. Composes existing modules only; computes nothing new. The CLI
// entry (scripts/benchmark.js) prints this for a committed sample fixture;
// tests render it directly. No timestamps: identical input, identical text.

import type { CompetitionResultInput } from "./competitionPrediction";
import { runBacktest } from "./backtesting";
import { computeCalibrationReport, toCalibrationCases } from "./calibration";
import { computeErrorNotes, ERROR_NOTE_LABELS } from "./errorNotes";
import { buildMlDataset } from "./mlDataset";
import { compareModels, explainBestModel, runFeatureAblation, MODEL_LABELS } from "./modelComparison";
import { explainNearestNeighbors, fitLinearRegression } from "./predictionModels";
import type { CoachSolve } from "./trainingSignals";

// No `now` input: the evaluation is entirely retrospective, driven by
// competition dates — nothing in the report depends on wall-clock time.
export interface BenchmarkInput {
  event: string;
  solves: CoachSolve[];
  competitionResults: CompetitionResultInput[];
  /** Shown in the report header so sample data can never pass as real results. */
  dataLabel: string;
}

const fmtS = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(2)}s`);
const fmtSignedS = (ms: number | null) => (ms === null ? "-" : `${ms >= 0 ? "+" : ""}${(ms / 1000).toFixed(2)}s`);
const fmtPct = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)}%`);
const col = (value: string | number, width: number) => String(value).padEnd(width);
const num = (value: string | number, width: number) => String(value).padStart(width);

export function renderBenchmarkReport(input: BenchmarkInput): string {
  const { event, solves, competitionResults, dataLabel } = input;
  const lines: string[] = [];

  lines.push("CubeBox model benchmark");
  lines.push(dataLabel);
  lines.push("");
  lines.push(`Event: ${event}`);

  const dataset = buildMlDataset(solves, competitionResults, event);
  lines.push("");
  lines.push("DATASET");
  lines.push(`  practice solves              ${solves.length}`);
  lines.push(`  competition results          ${competitionResults.length}`);
  lines.push(`  usable rows                  ${dataset.stats.rowCount}`);
  lines.push(`  walk-forward cases           ${dataset.stats.caseCount}`);
  lines.push(`  rows without practice data   ${dataset.stats.rowsWithoutPracticeData}`);

  const comparison = compareModels(solves, competitionResults, event);
  lines.push("");
  lines.push("MODEL COMPARISON (walk-forward)");
  lines.push(`  ${col("Model", 26)}${num("n", 3)}${num("MAE", 9)}${num("RMSE", 9)}${num("MAPE", 8)}${num("Bias", 9)}`);
  for (const m of comparison.metrics) {
    const best = m.modelId === comparison.bestModelId ? " *" : "";
    lines.push(
      `  ${col(m.label, 26)}${num(m.evaluatedCount, 3)}${num(fmtS(m.maeMs), 9)}${num(fmtS(m.rmseMs), 9)}${num(fmtPct(m.mapePct), 8)}${num(fmtSignedS(m.biasMs), 9)}${best}`
    );
  }
  lines.push(`  * ${explainBestModel(comparison)}`);

  const backtest = runBacktest(solves, competitionResults, event);
  const calibration = computeCalibrationReport(toCalibrationCases(backtest.cases));
  lines.push("");
  lines.push("CALIBRATION (rule-based intervals only — baselines and statistical models produce point predictions)");
  if (calibration.evaluatedCount === 0) {
    lines.push("  no intervals to evaluate");
  } else {
    lines.push(`  intervals evaluated   ${calibration.evaluatedCount}`);
    lines.push(`  covered               ${calibration.coveredCount} (${fmtPct(calibration.coveragePct)})`);
    lines.push(`  mean interval width   ${fmtS(calibration.meanIntervalWidth)}`);
    lines.push(`  mean absolute error   ${fmtS(calibration.meanAbsoluteError)}`);
    lines.push(`  misses                ${calibration.underPredictionCount} under / ${calibration.overPredictionCount} over`);
  }

  const ablation = runFeatureAblation(solves, competitionResults, event);
  lines.push("");
  lines.push("FEATURE ABLATION (ridge + k-NN; directional only at this label count — do not rank small deltas)");
  lines.push(`  ${col("Removed feature", 24)}${num("Ridge MAE", 11)}${num("Ridge Bias", 12)}${num("kNN MAE", 10)}${num("kNN Bias", 11)}`);
  const ablationRow = (label: string, metrics: typeof ablation.allFeatures) => {
    const ridge = metrics.find((m) => m.modelId === "linear-regression");
    const knn = metrics.find((m) => m.modelId === "nearest-neighbor");
    lines.push(
      `  ${col(label, 24)}${num(fmtS(ridge?.maeMs ?? null), 11)}${num(fmtSignedS(ridge?.biasMs ?? null), 12)}${num(fmtS(knn?.maeMs ?? null), 10)}${num(fmtSignedS(knn?.biasMs ?? null), 11)}`
    );
  };
  ablationRow("(none)", ablation.allFeatures);
  for (const entry of ablation.entries) {
    ablationRow(entry.removedFeature, entry.metrics);
  }

  const lastCase = dataset.cases[dataset.cases.length - 1];
  lines.push("");
  lines.push("EXPLANATIONS (most recent walk-forward case)");
  if (!lastCase) {
    lines.push("  no walk-forward case to explain");
  } else {
    lines.push(`  target: ${lastCase.target.competitionId} (${lastCase.target.date.slice(0, 10)}), actual ${fmtS(lastCase.target.targetAverageMs)}`);
    const trainingRows = lastCase.trainingRows.map((r) => ({ features: r.features, actualAverageMs: r.targetAverageMs }));

    const ridge = fitLinearRegression(trainingRows).explain(lastCase.target.features);
    lines.push("  ridge (model mechanics, not feature importance — correlated predictors share attribution):");
    if (ridge === null) {
      lines.push("    not fittable for this case");
    } else {
      lines.push(`    ${col("intercept (training mean)", 28)}${num(fmtS(ridge.interceptMs), 9)}`);
      for (const c of ridge.contributions) {
        lines.push(`    ${col(c.feature, 28)}${num(fmtSignedS(c.contributionMs), 9)}`);
      }
      lines.push(`    ${col("prediction", 28)}${num(fmtS(ridge.predictedMs), 9)}`);
    }

    const knn = explainNearestNeighbors(lastCase.trainingRows, lastCase.target.features);
    lines.push("  k-NN neighbors:");
    if (knn === null) {
      lines.push("    no usable neighbors for this case");
    } else {
      for (const n of knn.neighbors) {
        lines.push(
          `    ${col(n.competitionId, 14)}${col(n.date.slice(0, 10), 12)}actual ${fmtS(n.actualAverageMs)}  dist ${n.distance.toFixed(2)}  weight ${n.weight.toFixed(2)}  contributes ${fmtS(n.contributionMs)}`
        );
      }
      lines.push(`    prediction ${fmtS(knn.predictedMs)}`);
    }
  }

  lines.push("");
  lines.push("ERROR NOTES (per walk-forward case; observed associations, not causes)");
  const rowsById = new Map(dataset.rows.map((r) => [r.competitionId, r]));
  const flaggedCases = backtest.cases
    .map((c) => ({ c, row: rowsById.get(c.competitionId) }))
    .filter((x) => x.row !== undefined)
    .map((x) => ({ id: x.c.competitionId, notes: computeErrorNotes(x.c, (x.row!).features) }))
    .filter((x) => x.notes.length > 0);
  if (flaggedCases.length === 0) {
    lines.push("  no flags");
  } else {
    for (const { id, notes } of flaggedCases) {
      lines.push(`  ${col(id, 14)}${notes.map((n) => ERROR_NOTE_LABELS[n]).join("; ")}`);
    }
  }

  lines.push("");
  lines.push(`Models: ${comparison.metrics.map((m) => MODEL_LABELS[m.modelId]).join(", ")}`);
  lines.push("Methodology: docs/architecture/model-evaluation.md");
  return lines.join("\n");
}
