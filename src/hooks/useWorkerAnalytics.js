import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import { logger } from "../logger.js";
import { analyticsClient } from "../worker/analyticsClient";

// Requests analytics nodes from the worker and keeps the latest valid
// result in React state.
//
// Staleness rules:
// - only the newest request issued by this hook instance may update state;
// - a result computed against an older datasetVersion than the client's
//   current one is discarded (the version bump already scheduled a re-run);
// - an event switch clears results immediately, so the previous event's
//   numbers are never shown as the new event's.
//
// Requests coalesce: while one is in flight, any number of dataset or
// parameter changes collapse into a single follow-up request for the
// latest state, so a burst of solves cannot queue a burst of heavy
// recomputations.
//
// The scheduler lives in a ref, outside effect lifecycles, on purpose: an
// effect re-run (including StrictMode's doubled effects) while a request
// is in flight must hand the follow-up to the CURRENT effect's parameters,
// not strand it in a disposed closure that can never apply its result.
export function useWorkerAnalytics(nodes, event, { client = analyticsClient } = {}) {
  const version = useSyncExternalStore(client.subscribe, client.getDatasetVersion);
  const [state, setState] = useState({ results: null, loading: true, forEvent: event, error: false });

  const schedulerRef = useRef(null);
  if (!schedulerRef.current) {
    const scheduler = {
      inFlight: false,
      dirty: false,
      seq: 0,
      mounted: true,
      params: null,
      pump() {
        if (!scheduler.mounted || !scheduler.params) return;
        if (scheduler.inFlight) {
          scheduler.dirty = true;
          return;
        }
        const { nodes: currentNodes, event: currentEvent, client: currentClient } = scheduler.params;
        scheduler.inFlight = true;
        const id = ++scheduler.seq;
        const startedAt = performance.now();
        currentClient
          .compute(currentNodes, currentEvent, Date.now())
          .then((outcome) => {
            scheduler.inFlight = false;
            if (scheduler.dirty) {
              scheduler.dirty = false;
              scheduler.pump();
              return;
            }
            if (!scheduler.mounted || id !== scheduler.seq) return;
            if (outcome.datasetVersion !== currentClient.getDatasetVersion()) return;
            logger.debug("Worker analytics computed.", {
              nodes: currentNodes,
              event: currentEvent,
              durationMs: Math.round(performance.now() - startedAt),
            });
            setState({ results: outcome.results, loading: false, forEvent: currentEvent, error: false });
          })
          .catch((error) => {
            scheduler.inFlight = false;
            if (scheduler.dirty) {
              scheduler.dirty = false;
              scheduler.pump();
              return;
            }
            if (!scheduler.mounted || id !== scheduler.seq) return;
            logger.warn("Worker analytics request failed.", {
              nodes: currentNodes,
              event: currentEvent,
              error: String(error),
            });
            setState((prev) => ({ ...prev, loading: false, error: true }));
          });
      },
    };
    schedulerRef.current = scheduler;
  }

  const nodesKey = nodes.join(",");
  useEffect(() => {
    const scheduler = schedulerRef.current;
    scheduler.mounted = true;
    if (version === 0) return undefined;
    scheduler.params = { nodes, event, client };
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
    scheduler.pump();
    return () => {
      scheduler.mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, event, nodesKey, client]);

  // Never expose another event's results, even for the render between an
  // event switch and the effect that re-requests.
  if (state.forEvent !== event) {
    return { results: null, loading: true, error: false };
  }
  return { results: state.results, loading: state.loading || version === 0, error: state.error };
}
