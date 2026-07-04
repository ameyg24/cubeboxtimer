// useCsTimerImport.js - Orchestrates a csTimer practice-solve import:
// parse -> dedupe -> persist. All the actual parsing/dedup decision-making
// lives in the pure analytics/cstimerImport.ts module; this hook only owns
// the status/summary state and calls the SAME addSolve the live timer and
// "Add past solve" use - imported solves go through the exact same
// offline-first persistence path (useSolveSessions), never a second storage
// system, and never touch competition results.
import { useCallback, useState } from "react";
import { filterOutDuplicates, parseCsTimerExport } from "../analytics";
import { createSolveId } from "./useSolveSessions.js";
import { logger } from "../logger.js";

export function useCsTimerImport({ getExistingSolvesForDimension, addSolve }) {
  const [status, setStatus] = useState("idle"); // idle | success | error
  const [summary, setSummary] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const runImport = useCallback(
    (rawText, cubeDimension) => {
      setErrorMessage("");
      setSummary(null);
      const startedAt = performance.now();
      logger.info("csTimer import started.", { cubeDimension });

      const { solves, invalidRowCount, parseError } = parseCsTimerExport(rawText);
      if (parseError) {
        setStatus("error");
        setErrorMessage(parseError);
        logger.warn("csTimer import could not parse the pasted data.", { cubeDimension, error: parseError });
        return;
      }

      const existingSolves = getExistingSolvesForDimension(cubeDimension);
      const { toImport, duplicateCount } = filterOutDuplicates(solves, existingSolves);

      toImport.forEach((solve) => {
        addSolve(
          {
            id: createSolveId(),
            millis: solve.millis,
            penalty: solve.penalty,
            reviewed: true,
            cubeDimension,
            localCreatedAt: solve.localCreatedAt,
          },
          cubeDimension
        );
      });

      const result = {
        importedCount: toImport.length,
        duplicateCount,
        invalidRowCount,
      };
      setSummary(result);
      setStatus("success");
      logger.info("csTimer import finished.", {
        cubeDimension,
        ...result,
        durationMs: Math.round(performance.now() - startedAt),
      });
    },
    [getExistingSolvesForDimension, addSolve]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setSummary(null);
    setErrorMessage("");
  }, []);

  return { status, summary, errorMessage, runImport, reset };
}
