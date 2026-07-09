// Firestore REST client - shared by every hook that syncs an offline write
// queue to Firestore (useSolveSessions, useCompetitionResults). Extracted
// out of useSolveSessions.js verbatim: this has no solve-specific knowledge
// at all, so duplicating it for a second entity type would just be copying
// the same ~60 lines twice.
import { firebaseProjectId } from "../firebase/config";

const SYNC_WRITE_TIMEOUT_MS = 10000;

export function withTimeout(promise, message, timeoutMs = SYNC_WRITE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, nestedValue]) => [key, toFirestoreValue(nestedValue)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

export function firestoreRestUrl(path, fieldPaths = []) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const params = new URLSearchParams();
  fieldPaths.forEach((fieldPath) => params.append("updateMask.fieldPaths", fieldPath));
  const query = params.toString();
  return `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/${encodedPath}${query ? `?${query}` : ""}`;
}

export async function firestoreRestRequest(user, path, options = {}) {
  if (!firebaseProjectId) throw new Error("Missing Firebase project ID.");
  const token = await withTimeout(user.getIdToken(), "Timed out getting Firebase auth token.");
  const response = await withTimeout(
    fetch(firestoreRestUrl(path, options.fieldPaths), {
      method: options.method || "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: options.data
        ? JSON.stringify({
            fields: Object.fromEntries(
              Object.entries(options.data).map(([key, value]) => [key, toFirestoreValue(value)])
            ),
          })
        : undefined,
    }),
    options.timeoutMessage || "Timed out writing to Firestore REST API."
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore REST ${response.status}: ${text}`);
  }
  return response;
}
