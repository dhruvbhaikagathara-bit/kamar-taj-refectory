import {
  applySyncResults,
  getPendingScans,
  markSyncAttempt,
} from "./storage";

import type {
  OfflineSyncItem,
  OfflineSyncItemResult,
} from "./types";

const BATCH_SIZE = 20;
const REQUEST_TIMEOUT_MS = 30000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OfflineSyncSummary = {
  confirmed: number;
  conflicts: number;
  rejected: number;
  pending: number;
  message: string;
};

export class OfflineSyncError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OfflineSyncError";
  }
}

// Prevent overlapping sync calls for the same account
// and device within this page.
// Cross-tab retries remain safe through backend scan IDs.
const runningSyncs = new Map<
  string,
  Promise<OfflineSyncSummary>
>();

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value)
  );
}

function isItemResult(
  value: unknown
): value is OfflineSyncItemResult {
  if (!isRecord(value)) return false;

  const validOutcome =
    value.outcome === "CONFIRMED" ||
    value.outcome === "CONFLICT" ||
    value.outcome === "REJECTED" ||
    value.outcome === "RETRY";

  return (
    isUuid(value.scanId) &&
    validOutcome &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.replayed === "boolean" &&
    (
      value.redemptionId === null ||
      isUuid(value.redemptionId)
    ) &&
    (
      value.outcome !== "CONFIRMED" ||
      isUuid(value.redemptionId)
    )
  );
}

function validateResponse(
  body: unknown,
  batch: OfflineSyncItem[]
): OfflineSyncItemResult[] {
  if (
    !isRecord(body) ||
    body.code !== "OFFLINE_SYNC_RESULT" ||
    !Array.isArray(body.results) ||
    body.results.length !== batch.length ||
    !body.results.every(isItemResult)
  ) {
    throw new OfflineSyncError(
      "INVALID_SYNC_RESPONSE",
      "The server response could not be confirmed. Unconfirmed scans remain pending."
    );
  }

  const expectedIds = new Set(
    batch.map((scan) => scan.scanId)
  );

  const receivedIds = new Set<string>();

  for (const result of body.results) {
    if (
      !expectedIds.has(result.scanId) ||
      receivedIds.has(result.scanId)
    ) {
      throw new OfflineSyncError(
        "INVALID_SYNC_RESPONSE",
        "The sync response contained unexpected scan IDs. Unconfirmed scans remain pending."
      );
    }

    receivedIds.add(result.scanId);
  }

  return body.results;
}

async function uploadBatch(
  batch: OfflineSyncItem[]
): Promise<OfflineSyncItemResult[]> {
  const controller = new AbortController();

  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      "/api/checkin/offline/sync",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          scans: batch,
        }),
      }
    );

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new OfflineSyncError(
        "INVALID_SYNC_RESPONSE",
        "The server response could not be read. Unconfirmed scans remain pending."
      );
    }

    if (!response.ok) {
      const code =
        isRecord(body) && typeof body.code === "string"
          ? body.code
          : "SYNC_FAILED";

      const message =
        isRecord(body) &&
        typeof body.message === "string"
          ? body.message
          : "Synchronization failed. Unconfirmed scans remain pending.";

      throw new OfflineSyncError(code, message);
    }

    return validateResponse(body, batch);
  } catch (error) {
    if (error instanceof OfflineSyncError) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new OfflineSyncError(
        "SYNC_TIMEOUT",
        "Synchronization timed out. The server may have processed some scans; retrying their existing IDs is safe."
      );
    }

    throw new OfflineSyncError(
      "NETWORK_ERROR",
      "Unable to contact the server. Unconfirmed scans remain pending."
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

async function performSync(
  scannerId: string,
  deviceId: string
): Promise<OfflineSyncSummary> {
  // Take a snapshot: scans added during this run will
  // be picked up by the next synchronization.
  const queued = await getPendingScans(
    scannerId,
    deviceId
  );

  let confirmed = 0;
  let conflicts = 0;
  let rejected = 0;
  let stoppedForRetry = false;

  for (
    let offset = 0;
    offset < queued.length;
    offset += BATCH_SIZE
  ) {
    const storedBatch = queued.slice(
      offset,
      offset + BATCH_SIZE
    );

    const batch: OfflineSyncItem[] = storedBatch.map(
      (scan) => ({
        scanId: scan.scanId,
        sessionId: scan.sessionId,
        deviceId: scan.deviceId,
        mealId: scan.mealId,
        token: scan.token,
        observedAt: scan.observedAt,
      })
    );

    await markSyncAttempt(
      batch.map((scan) => scan.scanId),
      scannerId,
      deviceId
    );

    const results = await uploadBatch(batch);

    // Commit local results before reporting success.
    // If this fails, retrying still uses the same scan IDs.
    await applySyncResults(
      results,
      scannerId,
      deviceId
    );

    for (const result of results) {
      if (result.outcome === "CONFIRMED") {
        confirmed += 1;
      } else if (result.outcome === "CONFLICT") {
        conflicts += 1;
      } else if (result.outcome === "REJECTED") {
        rejected += 1;
      } else {
        stoppedForRetry = true;
      }
    }

    // Avoid repeatedly contacting the server when it
    // asks us to retry or scanner authorization changes.
    if (stoppedForRetry) break;
  }

  const remaining = await getPendingScans(
    scannerId,
    deviceId
  );

  return {
    confirmed,
    conflicts,
    rejected,
    pending: remaining.length,
    message:
      queued.length === 0
        ? "No pending scans to synchronize."
        : stoppedForRetry
          ? "Available results saved. Some scans remain pending; retry shortly or check your login."
          : remaining.length > 0
            ? "Synchronization finished. Newly queued scans are waiting for the next sync."
            : "Synchronization finished. Review any conflicts or rejected scans.",
  };
}

export function syncPendingScans(
  scannerId: string,
  deviceId: string
): Promise<OfflineSyncSummary> {
  if (
    !isUuid(scannerId) ||
    !isUuid(deviceId)
  ) {
    return Promise.reject(
      new OfflineSyncError(
        "INVALID_SCANNER",
        "A valid scanner account and device are required."
      )
    );
  }

  const key = `${scannerId}:${deviceId}`;
  const existing = runningSyncs.get(key);

  if (existing) return existing;

  const task = performSync(
    scannerId,
    deviceId
  ).finally(() => {
    runningSyncs.delete(key);
  });

  runningSyncs.set(key, task);

  return task;
}