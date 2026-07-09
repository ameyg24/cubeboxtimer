// wcaApi.js - Thin fetch layer over the WCA public API. No auth, no OAuth,
// read-only public data only. Reuses withTimeout from firestoreRest.js
// rather than re-implementing a second timeout-racer.
//
// CORS: verified against the live API before writing this file (`curl` with
// an Origin header set, since curl isn't itself subject to CORS - that's a
// browser-enforced restriction, not a server one). Every endpoint used here
// responds with `access-control-allow-origin: *`, so a direct browser
// fetch() works with no proxy or backend needed. This is unauthenticated
// best-effort public access, not a documented SLA - the WCA could change
// this at any time, which is why every call here is wrapped with a timeout
// and a clear error message rather than assumed to always succeed.
import { withTimeout } from "./firestoreRest.js";

const WCA_API_BASE = "https://www.worldcubeassociation.org/api/v0";
const WCA_FETCH_TIMEOUT_MS = 15000;

// Competitors with a long history (40+ competitions) turn the per-competition
// metadata lookup into a burst of dozens of simultaneous requests, which the
// WCA API rate-limits with 429s (observed live, not hypothetical - importing
// a prolific competitor's ID reproduces it every time). This behaves like a
// token bucket, not a fixed cooldown window (verified live): a deliberately
// triggered block from a 150-request burst still let a single probe request
// through ~33s later, and a 30-request burst succeed in full ~50s later - so
// capacity trickles back continuously rather than resetting all at once at a
// fixed time. Retry-After is also unusable here: it's not on the CORS
// same-origin-safelisted response header list and worldcubeassociation.org
// doesn't send Access-Control-Expose-Headers, so cross-origin fetch() can
// never read it even when the server sends one (verified: response.headers
// only exposes cache-control/content-length/content-type/last-modified here)
// - every retry delay below is necessarily the fallback exponential backoff,
// never server-directed. Retrying a 429 with backoff and capping how many of
// those requests run at once keeps the import a well-behaved client instead
// of silently losing results to rate limiting.
const RATE_LIMIT_MAX_RETRIES = 6;
const RATE_LIMIT_BASE_DELAY_MS = 3000;
const RATE_LIMIT_MAX_DELAY_MS = 30000;
export const WCA_METADATA_FETCH_CONCURRENCY = 2;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// The 429 window is shared by the whole client, not per-request: once it's
// hit, every in-flight worker among mapWithConcurrency's concurrent workers
// gets 429'd, not just the one that discovered it first. Retrying each
// request independently means every worker's own backoff timer elapses
// around the same time and they all re-fire into the *same* still-active
// window together, burning through their retry budget and giving up -
// reproduced live importing a real account with ~80 competitions, which
// silently dropped the ~40 most recent (chronologically last-processed)
// results as "competition details unavailable". A rate-limit state shared
// across one import's concurrent calls fixes this: the first 429 sets a
// blockedUntil every worker (including ones that haven't made their first
// request yet) waits out together, so only one request needs to ever
// actually hit the limit.
export function createRateLimitState() {
  return { blockedUntil: 0 };
}

async function waitForRateLimitState(rateLimitState) {
  if (!rateLimitState) return;
  const remaining = rateLimitState.blockedUntil - Date.now();
  if (remaining > 0) await sleep(remaining);
}

async function fetchWithRateLimitRetry(url, timeoutMessage, rateLimitState) {
  for (let attempt = 0; ; attempt += 1) {
    await waitForRateLimitState(rateLimitState);
    const response = await withTimeout(fetch(url), timeoutMessage, WCA_FETCH_TIMEOUT_MS);
    if (response.status !== 429) return response;
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const delayMs = Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
    if (rateLimitState) {
      rateLimitState.blockedUntil = Math.max(rateLimitState.blockedUntil, Date.now() + delayMs);
    }
    if (attempt >= RATE_LIMIT_MAX_RETRIES) return response;
    await sleep(delayMs);
  }
}

// Runs `fn` over `items` with at most `limit` calls in flight at once,
// preserving each result at its original index.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// GET /persons/{wcaId}/results - every result the person has ever recorded,
// across every event and round. See analytics/wcaImport.ts for how this is
// reduced down to one result per (competition, event).
export async function fetchWcaPersonResults(wcaId) {
  const response = await withTimeout(
    fetch(`${WCA_API_BASE}/persons/${encodeURIComponent(wcaId)}/results`),
    "Timed out fetching WCA results.",
    WCA_FETCH_TIMEOUT_MS
  );
  if (response.status === 404) {
    throw new Error(`No WCA competitor found with ID "${wcaId}".`);
  }
  if (!response.ok) {
    throw new Error(`WCA API error (${response.status}) while fetching results.`);
  }
  return response.json();
}

// GET /competitions/{id} - just the fields the import needs (name, date).
// There's no bulk-lookup endpoint (verified), so this is called once per
// unique competition_id the person has results for, with retry-on-429 above.
export async function fetchWcaCompetitionMeta(competitionId, rateLimitState) {
  const response = await fetchWithRateLimitRetry(
    `${WCA_API_BASE}/competitions/${encodeURIComponent(competitionId)}`,
    `Timed out fetching details for competition "${competitionId}".`,
    rateLimitState
  );
  if (!response.ok) {
    throw new Error(`WCA API error (${response.status}) while fetching competition "${competitionId}".`);
  }
  const data = await response.json();
  return {
    name: data.name,
    date: new Date(data.start_date).toISOString(),
  };
}
