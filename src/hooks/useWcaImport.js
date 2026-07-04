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
  findLinkedWcaId,
  isValidWcaId,
  mapWcaEventToCubeDimension,
  normalizeWcaId,
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
  // { completed, total } while checking competition metadata, else null -
  // lets the UI show real progress instead of a bare "Importing…" for what
  // can be a couple minutes on accounts with many competitions.
  const [progress, setProgress] = useState(null);

  const runImport = useCallback(
    async (rawWcaId) => {
      const wcaId = normalizeWcaId(rawWcaId);
      if (!isValidWcaId(wcaId)) {
        setStatus("error");
        setErrorMessage('Enter a valid WCA ID, e.g. "2009ZEMD01".');
        return;
      }

      // Imports are locked to a single WCA ID once any exist, so two
      // different competitors' results can never end up mixed into one
      // history - see analytics/wcaImport.ts's findLinkedWcaId. The WcaImport
      // UI already locks the WCA ID field once this is set, making this
      // mismatch unreachable through normal use; this check is what actually
      // enforces it.
      const linkedWcaId = findLinkedWcaId(competitions);
      if (linkedWcaId && linkedWcaId !== wcaId) {
        setStatus("error");
        setErrorMessage(
          `Imports are linked to WCA ID "${linkedWcaId}". Delete all imported results first to import a different WCA ID.`
        );
        return;
      }

      setStatus("loading");
      setErrorMessage("");
      setSummary(null);
      setProgress(null);
      const startedAt = performance.now();
      logger.info("WCA import started.", { wcaId });

      try {
        const rawResults = await fetchWcaPersonResults(wcaId);

        // Only fetch metadata for competitions with at least one
        // potentially-importable (supported event) result - no point
        // fetching details for a competition where the person only did
        // blindfolded or FMC.
        const relevantCompetitionIds = [
          ...new Set(
            rawResults
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
              logger.warn("Failed to fetch WCA competition metadata; its results will be skipped.", {
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

        const { candidates, skipped } = buildImportCandidates(rawResults, competitionMetaById);

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
              wcaRoundId: candidate.wcaRoundId,
              roundLabel: candidate.roundLabel,
              wcaId,
            });
            created.push(candidate);
          } else if (decision.type === "update") {
            // Overwrites every WCA-sourced field with this run's values,
            // including averageMs/bestMs - a re-import is always treated as
            // more authoritative than whatever was previously imported (e.g.
            // a results correction or late DQ on WCA's side), never merged.
            updateCompetitionResult(decision.existingId, {
              competitionName: candidate.competitionName,
              date: candidate.date,
              averageMs: candidate.averageMs,
              bestMs: candidate.bestMs,
              source: "wca-import",
              wcaCompetitionId: candidate.wcaCompetitionId,
              wcaRoundId: candidate.wcaRoundId,
              roundLabel: candidate.roundLabel,
              wcaId,
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
        setProgress(null);
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
        setProgress(null);
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
    setProgress(null);
  }, []);

  return { status, summary, errorMessage, progress, runImport, reset };
}
