// Entry for `npm run benchmark:models` (run via vite-node so it can import
// the TypeScript analytics directly). Prints to stdout only.
/* eslint-disable no-console -- CLI entry; stdout is the interface */
import { renderBenchmarkReport } from "../src/analytics/benchmarkReport";
import { buildSampleData, SAMPLE_DATA_LABEL, SAMPLE_EVENT } from "./benchmarkData";

const { solves, competitionResults } = buildSampleData();
console.log(
  renderBenchmarkReport({
    event: SAMPLE_EVENT,
    solves,
    competitionResults,
    dataLabel: SAMPLE_DATA_LABEL,
  })
);
