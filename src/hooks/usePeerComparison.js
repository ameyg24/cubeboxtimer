// usePeerComparison.js - Fetches another WCA competitor's public results and
// turns them into a competition-history-only prediction (see
// analytics/peerComparison.ts) for side-by-side comparison against the
// local user's own practice-based prediction. Deliberately ephemeral: reuses
// the exact same fetch layer (wcaApi.js) and round-conversion pipeline
// (buildImportCandidates/collapseRoundsToReference) as the real WCA import,
// but nothing here is persisted - it's not the local user's data, so it
// never touches useCompetitionResults or localStorage. A fresh Compare
// click re-fetches from scratch every time.
import { useCallback, useState } from "react";
import {
  buildImportCandidates,
  collapseRoundsToReference,
  isValidWcaId,
  normalizeWcaId,
  predictFromCompetitionHistory,
} from "../analytics";
import {
  createRateLimitState,
  fetchWcaCompetitionMeta,
  fetchWcaPersonResults,
  mapWithConcurrency,
  WCA_METADATA_FETCH_CONCURRENCY,
} from "./wcaApi.js";
import { logger } from "../logger.js";

export function usePeerComparison() {
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState(null);

  const compare = useCallback(async (rawWcaId, event) => {
    const wcaId = normalizeWcaId(rawWcaId);
    if (!isValidWcaId(wcaId)) {
      setStatus("error");
      setErrorMessage('Enter a valid WCA ID, e.g. "2009ZEMD01".');
      return;
    }

    setStatus("loading");
    setErrorMessage("");
    setResult(null);
    setProgress(null);
    const startedAt = performance.now();
    logger.info("Peer comparison started.", { wcaId, event });

    try {
      const rawResults = await fetchWcaPersonResults(wcaId);
      const personName = rawResults.find((r) => r.name)?.name || null;

      const relevantCompetitionIds = [...new Set(rawResults.map((r) => r.competition_id))];
      const rateLimitState = createRateLimitState();
      setProgress({ completed: 0, total: relevantCompetitionIds.length });
      let completedCount = 0;
      const metaEntries = await mapWithConcurrency(
        relevantCompetitionIds,
        WCA_METADATA_FETCH_CONCURRENCY,
        async (competitionId) => {
          try {
            const meta = await fetchWcaCompetitionMeta(competitionId, rateLimitState);
            return [competitionId, meta];
          } catch (error) {
            logger.warn("Failed to fetch WCA competition metadata for a peer comparison; its result will be skipped.", {
              competitionId,
              error,
            });
            return [competitionId, null];
          } finally {
            completedCount += 1;
            setProgress({ completed: completedCount, total: relevantCompetitionIds.length });
          }
        }
      );
      const competitionMetaById = new Map(metaEntries.filter(([, meta]) => meta !== null));

      // Reuses the exact same round labeling/skip logic as a real import
      // (analytics/wcaImport.ts), just scoped to the one event being
      // compared and never persisted.
      const { candidates } = buildImportCandidates(rawResults, competitionMetaById);
      const rounds = candidates
        .filter((c) => c.event === event)
        .map((c) => ({
          id: `${c.wcaCompetitionId}-${c.wcaRoundId}`,
          competitionName: c.competitionName,
          date: c.date,
          event: c.event,
          averageMs: c.averageMs,
          bestMs: c.bestMs,
          source: "wca-import",
          wcaCompetitionId: c.wcaCompetitionId,
          wcaRoundId: c.wcaRoundId,
          roundLabel: c.roundLabel,
        }));

      const history = collapseRoundsToReference(rounds)
        .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0))
        .map((c) => ({
          id: c.wcaCompetitionId,
          competitionName: c.competitionName,
          date: c.date,
          averageMs: c.averageMs,
          bestMs: c.bestMs,
        }));

      const prediction = predictFromCompetitionHistory(history, event, wcaId, personName);
      setResult(prediction);
      setStatus("success");
      setProgress(null);
      logger.info("Peer comparison finished.", {
        wcaId,
        event,
        competitionsUsed: prediction.competitionsUsed,
        averageConfidenceLevel: prediction.average.confidenceLevel,
        bestConfidenceLevel: prediction.best.confidenceLevel,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      setStatus("error");
      setErrorMessage(error?.message || "Comparison failed. Please try again.");
      setProgress(null);
      logger.error("Peer comparison failed.", {
        wcaId,
        event,
        error,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setErrorMessage("");
    setProgress(null);
  }, []);

  return { status, result, errorMessage, progress, compare, reset };
}
