import type {
  LocalCollectionMarker,
  OfflineSyncItemResult,
  StoredOfflinePreparation,
  StoredOfflineScan,
} from "./types";

const DATABASE_NAME = "kamar-taj-offline-scanning";
const DATABASE_VERSION = 1;

const STORES = {
  metadata: "metadata",
  preparations: "preparations",
  scans: "scans",
  collections: "collections",
} as const;

export class OfflineStorageError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OfflineStorageError";
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (
    typeof window === "undefined" ||
    !window.indexedDB
  ) {
    return Promise.reject(
      new OfflineStorageError(
        "STORAGE_UNAVAILABLE",
        "Offline storage is unavailable in this browser."
      )
    );
  }

  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(
      DATABASE_NAME,
      DATABASE_VERSION
    );

    let blocked = false;

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.metadata)) {
        db.createObjectStore(STORES.metadata);
      }

      if (
        !db.objectStoreNames.contains(STORES.preparations)
      ) {
        db.createObjectStore(STORES.preparations, {
          keyPath: "sessionId",
        });
      }

      if (!db.objectStoreNames.contains(STORES.scans)) {
        const scans = db.createObjectStore(STORES.scans, {
          keyPath: "scanId",
        });

        scans.createIndex(
          "scannerDevice",
          ["scannerId", "deviceId"],
          { unique: false }
        );
      }

      if (
        !db.objectStoreNames.contains(STORES.collections)
      ) {
        db.createObjectStore(STORES.collections, {
          keyPath: ["mealId", "studentId"],
        });
      }
    };

    request.onblocked = () => {
      blocked = true;
      databasePromise = null;

      reject(
        new OfflineStorageError(
          "STORAGE_BLOCKED",
          "Close other scanner tabs, then try again."
        )
      );
    };

    request.onerror = () => {
      databasePromise = null;

      reject(
        request.error ??
          new Error("Unable to open offline storage.")
      );
    };

    request.onsuccess = () => {
      const db = request.result;

      if (blocked) {
        db.close();
        return;
      }

      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };

      resolve(db);
    };
  });

  return databasePromise;
}

// Start requests synchronously inside this callback.
// Do not await network requests inside an IDB transaction.
async function transact<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (
    transaction: IDBTransaction,
    finish: (value: T) => void,
    fail: (error: Error) => void
  ) => void
): Promise<T> {
  const db = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;

    try {
      transaction = db.transaction(storeNames, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let result: T;
    let hasResult = false;
    let failure: Error | null = null;

    function finish(value: T) {
      result = value;
      hasResult = true;
    }

    function fail(error: Error) {
      failure = error;

      try {
        transaction.abort();
      } catch {
        reject(error);
      }
    }

    transaction.oncomplete = () => {
      if (failure) {
        reject(failure);
      } else if (!hasResult) {
        reject(
          new Error("Offline storage returned no result.")
        );
      } else {
        resolve(result);
      }
    };

    transaction.onabort = () => {
      reject(
        failure ??
          transaction.error ??
          new Error(
            "Offline storage failed. The scan was not saved."
          )
      );
    };

    // Request errors normally abort the transaction.
    transaction.onerror = () => {
      failure ??=
        transaction.error ??
        new Error("Offline storage operation failed.");
    };

    try {
      work(transaction, finish, fail);
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new Error("Offline storage operation failed.")
      );
    }
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  if (!globalThis.crypto?.randomUUID) {
    throw new OfflineStorageError(
      "SECURE_CONTEXT_REQUIRED",
      "Open the scanner through HTTPS or localhost."
    );
  }

  return transact<string>(
    [STORES.metadata],
    "readwrite",
    (transaction, finish) => {
      const store = transaction.objectStore(
        STORES.metadata
      );

      const request = store.get("deviceId");

      request.onsuccess = () => {
        if (typeof request.result === "string") {
          finish(request.result);
          return;
        }

        const deviceId = crypto.randomUUID();

        store.add(deviceId, "deviceId");
        finish(deviceId);
      };
    }
  );
}

export async function savePreparation(
  preparation: StoredOfflinePreparation
): Promise<void> {
  if (
    preparation.sessionId !==
    preparation.session.sessionId
  ) {
    throw new OfflineStorageError(
      "INVALID_PREPARATION",
      "Offline session IDs do not match."
    );
  }

  await transact<void>(
    [STORES.preparations],
    "readwrite",
    (transaction, finish) => {
      transaction
        .objectStore(STORES.preparations)
        .put(preparation);

      finish(undefined);
    }
  );
}

export async function getPreparation(
  sessionId: string,
  scannerId: string,
  deviceId: string
): Promise<StoredOfflinePreparation | null> {
  return transact<StoredOfflinePreparation | null>(
    [STORES.preparations],
    "readonly",
    (transaction, finish) => {
      const request = transaction
        .objectStore(STORES.preparations)
        .get(sessionId);

      request.onsuccess = () => {
        const preparation = request.result as
          | StoredOfflinePreparation
          | undefined;

        if (
          !preparation ||
          preparation.session.scannerId !== scannerId ||
          preparation.session.deviceId !== deviceId
        ) {
          finish(null);
          return;
        }

        finish(preparation);
      };
    }
  );
}

// Call only after successful local signature, expiry,
// session-window, and eligibility verification.
// Local storage itself is not a security boundary.
export async function enqueueOfflineScan(
  scan: StoredOfflineScan
): Promise<void> {
  if (
    scan.status !== "PENDING_SYNC" ||
    scan.syncAttempts !== 0
  ) {
    throw new OfflineStorageError(
      "INVALID_SCAN",
      "A new scan must start as pending sync."
    );
  }

  await transact<void>(
    [
      STORES.preparations,
      STORES.scans,
      STORES.collections,
    ],
    "readwrite",
    (transaction, finish, fail) => {
      const preparations = transaction.objectStore(
        STORES.preparations
      );
      const scans = transaction.objectStore(STORES.scans);
      const collections = transaction.objectStore(
        STORES.collections
      );

      const preparationRequest = preparations.get(
        scan.sessionId
      );

      preparationRequest.onsuccess = () => {
        const preparation = preparationRequest.result as
          | StoredOfflinePreparation
          | undefined;

        if (
          !preparation ||
          preparation.session.scannerId !== scan.scannerId ||
          preparation.session.deviceId !== scan.deviceId ||
          preparation.session.mealId !== scan.mealId ||
          !preparation.session.eligibleStudentIds.includes(
            scan.studentId
          )
        ) {
          fail(
            new OfflineStorageError(
              "PREPARATION_MISMATCH",
              "This scan does not match the saved offline preparation."
            )
          );
          return;
        }

        const duplicateRequest = collections.get([
          scan.mealId,
          scan.studentId,
        ]);

        duplicateRequest.onsuccess = () => {
          if (duplicateRequest.result) {
            fail(
              new OfflineStorageError(
                "LOCAL_DUPLICATE",
                "This student already has a collection or pending scan on this browser."
              )
            );
            return;
          }

          const marker: LocalCollectionMarker = {
            mealId: scan.mealId,
            studentId: scan.studentId,
            scanId: scan.scanId,
            source: "OFFLINE",
            recordedAt: scan.observedAt,
          };

          scans.add(scan);
          collections.add(marker);

          // Promise resolves only after both writes commit.
          finish(undefined);
        };
      };
    }
  );
}

export async function getStoredScans(
  scannerId: string,
  deviceId: string
): Promise<StoredOfflineScan[]> {
  return transact<StoredOfflineScan[]>(
    [STORES.scans],
    "readonly",
    (transaction, finish) => {
      const request = transaction
        .objectStore(STORES.scans)
        .index("scannerDevice")
        .getAll(
          IDBKeyRange.only([scannerId, deviceId])
        );

      request.onsuccess = () => {
        const scans = request.result as StoredOfflineScan[];

        finish(
          scans.sort((a, b) =>
            a.observedAt.localeCompare(b.observedAt)
          )
        );
      };
    }
  );
}

export async function getPendingScans(
  scannerId: string,
  deviceId: string
): Promise<StoredOfflineScan[]> {
  const scans = await getStoredScans(scannerId, deviceId);

  return scans.filter(
    (scan) => scan.status === "PENDING_SYNC"
  );
}

export async function markSyncAttempt(
  scanIds: string[],
  scannerId: string,
  deviceId: string
): Promise<void> {
  const attemptedAt = new Date().toISOString();

  await transact<void>(
    [STORES.scans],
    "readwrite",
    (transaction, finish) => {
      const store = transaction.objectStore(STORES.scans);

      for (const scanId of new Set(scanIds)) {
        const request = store.get(scanId);

        request.onsuccess = () => {
          const scan = request.result as
            | StoredOfflineScan
            | undefined;

          if (
            !scan ||
            scan.scannerId !== scannerId ||
            scan.deviceId !== deviceId ||
            scan.status !== "PENDING_SYNC"
          ) {
            return;
          }

          store.put({
            ...scan,
            syncAttempts: scan.syncAttempts + 1,
            lastSyncAttemptAt: attemptedAt,
          } satisfies StoredOfflineScan);
        };
      }

      finish(undefined);
    }
  );
}

export async function applySyncResults(
  results: OfflineSyncItemResult[],
  scannerId: string,
  deviceId: string
): Promise<void> {
  const syncedAt = new Date().toISOString();

  await transact<void>(
    [STORES.scans],
    "readwrite",
    (transaction, finish, fail) => {
      const store = transaction.objectStore(STORES.scans);

      for (const result of results) {
        if (
          ![
            "CONFIRMED",
            "CONFLICT",
            "REJECTED",
            "RETRY",
          ].includes(result.outcome) ||
          (
            result.outcome === "CONFIRMED" &&
            !result.redemptionId
          )
        ) {
          fail(
            new OfflineStorageError(
              "INVALID_SYNC_RESULT",
              "The sync response could not be confirmed."
            )
          );
          return;
        }

        const request = store.get(result.scanId);

        request.onsuccess = () => {
          const scan = request.result as
            | StoredOfflineScan
            | undefined;

          if (
            !scan ||
            scan.scannerId !== scannerId ||
            scan.deviceId !== deviceId ||
            scan.status !== "PENDING_SYNC"
          ) {
            return;
          }

          const retry = result.outcome === "RETRY";

          store.put({
            ...scan,
           status:
                result.outcome === "RETRY"
                    ? "PENDING_SYNC"
    :               result.outcome,
            resultCode: result.code,
            resultMessage: result.message,
            redemptionId: retry
              ? null
              : result.redemptionId,
            syncedAt: retry ? null : syncedAt,
          } satisfies StoredOfflineScan);
        };
      }

      finish(undefined);
    }
  );

  // Collection markers remain, including for rejected
  // or conflicting records. Staff must investigate rather
  // than automatically serve the same student again.
}

export async function getLocalCollection(
  mealId: string,
  studentId: string
): Promise<LocalCollectionMarker | null> {
  return transact<LocalCollectionMarker | null>(
    [STORES.collections],
    "readonly",
    (transaction, finish) => {
      const request = transaction
        .objectStore(STORES.collections)
        .get([mealId, studentId]);

      request.onsuccess = () => {
        finish(
          (request.result as
            | LocalCollectionMarker
            | undefined) ?? null
        );
      };
    }
  );
}

// Call only after the backend confirms online acceptance.
export async function recordOnlineCollection(
  marker: LocalCollectionMarker
): Promise<void> {
  if (marker.source !== "ONLINE") {
    throw new OfflineStorageError(
      "INVALID_COLLECTION",
      "Expected a confirmed online collection."
    );
  }

  await transact<void>(
    [STORES.collections],
    "readwrite",
    (transaction, finish) => {
      const store = transaction.objectStore(
        STORES.collections
      );

      const request = store.get([
        marker.mealId,
        marker.studentId,
      ]);

      request.onsuccess = () => {
        // Preserve any existing pending-scan marker.
        if (!request.result) {
          store.add(marker);
        }

        finish(undefined);
      };
    }
  );
}