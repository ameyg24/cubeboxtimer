# Model Evaluation

How CubeBox's competition-prediction models are trained and scored. All of
this is pure TypeScript in `src/analytics` — no ML framework, no server,
no persisted model state.

## Why walk-forward evaluation

Competitions are a time series, and features include history-dependent
values (prior competition count, days since the last competition, the
rule-based model's error on the previous competition). A random
train/test split would let a model train on the future of the very
competition it is scored on. Instead, every evaluated competition is
predicted using only competitions strictly before its date — same-day
results excluded — and features computed as of that date. The split lives
in one place (`mlDataset.ts`) and is pinned by leakage tests that corrupt
future data and assert earlier rows don't move.

## Dataset builder (`mlDataset.ts`)

One deterministic source of truth for model-ready rows: one row per usable
competition (feature vector as of its date via `buildFeatureVector`,
official average as the target), the walk-forward cases built from those
rows, dataset statistics, and a numeric feature-matrix projection in the
exact column order the models train on (`MODEL_FEATURE_KEYS`).
`modelComparison.ts` consumes this instead of assembling rows itself.

## Why ridge regression and k-NN

Per-user, per-event training data is tiny — often fewer competitions than
features. Plain least squares is unsolvable there; ridge (closed-form,
fixed λ=1 on standardized features) stays well-defined at any sample size.
Weighted k-NN is the natural non-parametric counterpart: "competitions
where your form looked like this went like this," on the same
standardized feature space. Both degrade to no-prediction rather than
fabricating a number, and both are compared against the rule-based model
(`competitionPrediction.ts`) on identical cases with identical metrics
(`mlEvaluation.ts`: MAE, median AE, RMSE, MAPE, bias).

## Calibration (`calibration.ts`)

The rule-based prediction ships a confidence interval, so we also measure
whether those intervals deserve confidence: over walk-forward cases, how
often did the interval contain the actual official average (bounds
inclusive), how wide were the intervals, and did misses skew toward under-
or over-prediction. This is empirical coverage on one user's history — not
a significance test, and no causal claim.

## Limitations

- Sample sizes are small (competitions per user per event), so metric
  rankings between models can flip as history grows.
- Single-subject data: nothing here generalizes across users, and there is
  no cross-user corpus by design (local-first storage).
- MAPE assumes strictly positive actuals — true for solve averages.
- Intervals come from the rule-based model only; the regression and k-NN
  models produce point estimates without uncertainty.

## What would be tried next

- Interval estimates for the statistical models (e.g. residual-quantile
  bands) so calibration can compare all three.
- A pinball/quantile loss alongside coverage, so interval *width* is
  scored, not just hit rate.
- Feature ablation over `MODEL_FEATURE_KEYS` to check which of the four
  features actually carry signal at these sample sizes.
