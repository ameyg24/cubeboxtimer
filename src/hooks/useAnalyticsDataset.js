import { useEffect } from "react";
import { CUBE_DIMENSIONS } from "../storage/normalize";
import { analyticsClient } from "../worker/analyticsClient";

// Pushes the current durable dataset to the analytics worker after every
// change: full state replacement, measured at ~13 ms to clone 25K solves,
// chosen over an operation reducer because reducer/hook equivalence is not
// yet proven by tests. Gated on hydration so the worker is never
// initialized with the pre-hydration empty state.
export function useAnalyticsDataset({ sessions, competitions, ready, client = analyticsClient }) {
  useEffect(() => {
    if (!ready) return;
    const solvesByEvent = {};
    CUBE_DIMENSIONS.forEach((dimension) => {
      solvesByEvent[dimension] = sessions.flatMap((session) =>
        Array.isArray(session.solves?.[dimension]) ? session.solves[dimension] : []
      );
    });
    client.setDataset({ solvesByEvent, competitions });
  }, [sessions, competitions, ready, client]);
}
