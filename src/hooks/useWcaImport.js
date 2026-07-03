// useWcaImport.js - Orchestrates a WCA competition-result import: fetch,
// convert, deduplicate, and persist. All the actual decision-making (event
// mapping, time conversion, duplicate/conflict policy) lives in the pure
// analytics/wcaImport.ts module; this hook only owns the async flow and its
// status state, then calls the SAME addCompetitionResult/
// updateCompetitionResult that manual entry uses - imported results go
// through the exact same offline-first persistence path
// (useCompetitionResults), never a second storage system.
import { useCallback, useState } from "react";
import {
  buildImportCandidates,
  decideImportAction,
  isValidWcaId,
  mapWcaEventToCubeDimension,
  normalizeWcaId,
  selectFinalRoundResults,
} from "../analytics";
import {
  createRateLimitState,
  fetchWcaCompetitionMeta,
  fetchWcaPersonResults,
  mapWithConcurrency,
  WCA_METADATA_FETCH_CONCURRENCY,
} from "./wcaApi.js";
import { logger } from "../logger.js";

export function useWcaImport({ competitions, addCompetitionResult, updateCompetitionResult }) {
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [summary, setSummary] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const runImport = useCallback(
    async (rawWcaId) => {
      const wcaId = normalizeWcaId(rawWcaId);
      if (!isValidWcaId(wcaId)) {
        setStatus("error");
        setErrorMessage('Enter a valid WCA ID, e.g. "2009ZEMD01".');
        return;
      }

      setStatus("loading");
      setErrorMessage("");
      setSummary(null);
      const startedAt = performance.now();
      logger.info("WCA import started.", { wcaId });

      try {
        const rawResults = await fetchWcaPersonResults(wcaId);
        const finalRoundResults = selectFinalRoundResults(rawResults);

        // Only fetch metadata for competitions with at least one
        // potentially-importable (supported event) result - no point
        // fetching details for a competition where the person only did
        // blindfolded or FMC.
        const relevantCompetitionIds = [
          ...new Set(
            finalRoundResults
              .filter((r) => mapWcaEventToCubeDimension(r.event_id) !== null)
              .map((r) => r.competition_id)
          ),
        ];

        // Fetched with bounded concurrency, not Promise.all: a competitor
        // with a long history can have 100+ competitions, and firing that
        // many requests at once gets rate-limited by the WCA API (429s seen
        // live during testing). fetchWcaCompetitionMeta already retries a
        // single request's own 429s; this caps how many are in flight
        // together so most requests never hit that limit in the first place.
        // Shared across every concurrent worker below so a 429 discovered by
        // one of them backs off all of them together - see wcaApi.js's
        // createRateLimitState for why per-request-independent retries
        // weren't enough on their own.
        const rateLimitState = createRateLimitState();
        const metaEntries = await mapWithConcurrency(
          relevantCompetitionIds,
          WCA_METADATA_FETCH_CONCURRENCY,
          async (competitionId) => {
            try {
              const meta = await fetchWcaCompetitionMeta(competitionId, rateLimitState);
              return [competitionId, meta];
            } catch (error) {
              logger.warn("Failed to fetch WCA competition metadata; its results will be skipped.", {
                competitionId,
                error,
              });
              return [competitionId, null];
            }
          }
        );
        const competitionMetaById = new Map(metaEntries.filter(([, meta]) => meta !== null));

        const { candidates, skipped } = buildImportCandidates(finalRoundResults, competitionMetaById);

        const created = [];
        const updated = [];
        const alreadyImported = [];
        const duplicates = [];
        const conflicts = [];

        for (const candidate of candidates) {
          const decision = decideImportAction(candidate, competitions);
          if (decision.type === "create") {
            addCompetitionResult({
              competitionName: candidate.competitionName,
              date: candidate.date,
              event: candidate.event,
              averageMs: candidate.averageMs,
              bestMs: candidate.bestMs,
              source: "wca-import",
              wcaCompetitionId: candidate.wcaCompetitionId,
            });
            created.push(candidate);
          } else if (decision.type === "update") {
            updateCompetitionResult(decision.existingId, {
              competitionName: candidate.competitionName,
              date: candidate.date,
              averageMs: candidate.averageMs,
              bestMs: candidate.bestMs,
              source: "wca-import",
              wcaCompetitionId: candidate.wcaCompetitionId,
            });
            updated.push(candidate);
          } else if (decision.type === "skip-already-imported") {
            alreadyImported.push({ candidate, reason: decision.reason });
          } else if (decision.type === "skip-duplicate") {
            duplicates.push({ candidate, reason: decision.reason });
          } else if (decision.type === "conflict") {
            conflicts.push({ candidate, reason: decision.reason });
          }
        }

        // Every category a result can land in is tracked separately (rather
        // than one opaque "skipped" count) so the UI can explain exactly
        // why each result was or wasn't imported - see WcaImport.jsx.
        const result = {
          wcaId,
          createdCount: created.length,
          updatedCount: updated.length,
          alreadyImportedCount: alreadyImported.length,
          duplicateCount: duplicates.length,
          conflictCount: conflicts.length,
          unsupportedEventCount: skipped.filter((s) => s.reason === "unsupported-event").length,
          noAverageCount: skipped.filter((s) => s.reason === "no-average").length,
          dnfOrDnsCount: skipped.filter((s) => s.reason === "dnf-or-dns-average").length,
          metadataFailureCount: skipped.filter((s) => s.reason === "missing-competition-metadata").length,
          conflicts,
        };
        setSummary(result);
        setStatus("success");
        logger.info("WCA import finished.", {
          wcaId,
          createdCount: result.createdCount,
          updatedCount: result.updatedCount,
          alreadyImportedCount: result.alreadyImportedCount,
          duplicateCount: result.duplicateCount,
          conflictCount: result.conflictCount,
          unsupportedEventCount: result.unsupportedEventCount,
          noAverageCount: result.noAverageCount,
          dnfOrDnsCount: result.dnfOrDnsCount,
          metadataFailureCount: result.metadataFailureCount,
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        setStatus("error");
        setErrorMessage(error?.message || "Import failed. Please try again.");
        logger.error("WCA import failed.", {
          wcaId,
          error,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }
    },
    [competitions, addCompetitionResult, updateCompetitionResult]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setSummary(null);
    setErrorMessage("");
  }, []);

  return { status, summary, errorMessage, runImport, reset };
}
