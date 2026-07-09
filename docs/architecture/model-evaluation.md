# Model Evaluation

How CubeBox's competition-prediction models are trained and scored. All of
this is pure TypeScript in `src/analytics` - no ML framework, no server,
no persisted model state.

## Why walk-forward evaluation

Competitions are a time series, and features include history-dependent
values (prior competition count, days since the last competition, the
rule-based model's error on the previous competition). A random
train/test split would let a model train on the future of the very
competition it is scored on. Instead, every evaluated competition is
predicted using only competitions strictly before its date - same-day
results excluded - and features computed as of that date. The split lives
in one place (`mlDataset.ts`) and is pinned by leakage tests that corrupt
future data and assert earlier rows don't move.

## Dataset builder (`mlDataset.ts`)

One deterministic source of truth for model-ready rows: one row per usable
competition (feature vector as of its date via `buildFeatureVector`,
official average as the target), the walk-forward cases built from those
rows, dataset statistics, and a numeric feature-matrix projection in the
exact column order the models train on (`MODEL_FEATURE_KEYS`).
`modelComparison.ts` consumes this instead of assembling rows itself.

## Baselines

Three naive predictors run through the same walk-forward cases as the
models, because a model that can't beat "predict your practice mean"
hasn't earned its complexity: the all-history practice mean, the
rule-based model's own 14-day practice window without its adjustment, and
carrying the previous competition's average forward. On a metrics tie the
simplest predictor wins the best-model selection - a model must strictly
beat the baselines. Baselines produce point predictions only and never
appear in calibration.

## Why ridge regression and k-NN

Per-user, per-event training data is tiny - often fewer competitions than
features. Plain least squares is unsolvable there; ridge (closed-form,
fixed λ=1 on standardized features) stays well-defined at any sample size.
Weighted k-NN is the natural non-parametric counterpart: "competitions
where your form looked like this went like this," on the same
standardized feature space. Both degrade to no-prediction rather than
fabricating a number, and both are compared against the baselines and the
rule-based model (`competitionPrediction.ts`) on identical cases with
identical metrics (`mlEvaluation.ts`: MAE, median AE, RMSE, MAPE, bias).

## Feature ablation

`runFeatureAblation` re-runs the walk-forward comparison once per feature
with that column genuinely removed (never zeroed - a zeroed raw value
would pass through standardization as an off-manifold point). Only ridge
and k-NN are ablated; the rule-based model and the baselines never read
the feature vector, so including them would show fake invariance. Read
the deltas directionally: with this few competition labels, small MAE
differences are noise, and the output deliberately does not rank them.

## Attribution

Two explanation forms, both model mechanics rather than feature
importance. For ridge, `LinearRegressionFit.explain` returns the exact
additive terms of the fitted formula - intercept (training mean) plus one
signed contribution per feature, summing to the prediction; for a linear
model this is what SHAP reduces to under feature independence, which does
not hold here, so correlated predictors share attribution arbitrarily
under shrinkage. For k-NN, `explainNearestNeighbors` returns the specific
competitions the prediction was averaged from, with distances, normalized
weights, and per-neighbor contributions. Neither says which feature
*matters* - ablation is the predictive-value view; these describe how a
number was computed.

## Error notes

`computeErrorNotes` attaches deterministic flags to each walk-forward
case - few practice solves, high variance, a large applied competition
gap, low confidence at the time, interval miss - using the coach's
existing thresholds, no new ones. These are per-case observed
associations, not a failure taxonomy: at this label count there is no
distribution to summarize.

## Benchmark

`npm run benchmark:models` renders the whole pipeline - dataset, model
comparison, calibration, ablation, explanations, error notes - for a
committed synthetic fixture (`scripts/benchmarkData.ts`) and prints to
stdout. The output is labeled as sample data and contains no timestamps;
identical input renders identical text. Real user data is per-user and
local, so the benchmark never sees it - its numbers describe the fixture,
not the product.

## Calibration (`calibration.ts`)

The rule-based prediction ships a confidence interval, so we also measure
whether those intervals deserve confidence: over walk-forward cases, how
often did the interval contain the actual official average (bounds
inclusive), how wide were the intervals, and did misses skew toward under-
or over-prediction. This is empirical coverage on one user's history - not
a significance test, and no causal claim.

## Limitations

- Sample sizes are small (competitions per user per event), so metric
  rankings between models can flip as history grows.
- Single-subject data: nothing here generalizes across users, and there is
  no cross-user corpus by design (local-first storage).
- The four features are correlated, so ridge attribution splits credit
  arbitrarily between them; treat contributions as arithmetic, not
  importance.
- MAPE assumes strictly positive actuals - true for solve averages.
- Intervals come from the rule-based model only; the regression and k-NN
  models produce point estimates without uncertainty.
- Nothing here is causal inference: one subject, no interventions, no
  controls - every output is an observed association.

## What would be tried next

- Interval estimates for the statistical models (e.g. residual-quantile
  bands) so calibration can compare all three.
- A pinball/quantile loss alongside coverage, so interval *width* is
  scored, not just hit rate.
