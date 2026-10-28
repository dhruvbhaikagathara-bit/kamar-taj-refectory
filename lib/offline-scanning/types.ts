// Shared types for the scanner, local storage, and sync API.
// Do not add "server-only": the browser also imports these types.

export type OfflineSession = {
  sessionId: string;
  scannerId: string;
  deviceId: string;
  mealId: string;
  keyId: string;

  preparedAt: string;
  serveStart: string;
  serveEnd: string;

  captureStart: string;
  captureExpiresAt: string;
  syncDeadline: string;

  serverNow: string;
  eligibleStudentIds: string[];
  eligibleCount: number;
};

export type OfflineVerificationKey = {
  algorithm: "ES256";
  keyId: string;
  publicKeyPem: string;
};

export type OfflinePreparationResponse = {
  code: "OFFLINE_PREPARED";
  message: string;
  session: OfflineSession;
  verification: OfflineVerificationKey;
};

export type StoredOfflinePreparation = {
  // The local database uses the session ID as its key.
  sessionId: string;

  session: OfflineSession;
  verification: OfflineVerificationKey;

  // Informational browser timestamp, not trusted evidence.
  downloadedAt: string;
};

// A server-time anchor for the current page lifetime.
// performance.now() values must not be reused after reload.
export type OfflineClockAnchor = {
  sessionId: string;
  serverEpochMs: number;
  performanceMs: number;
};

export type OfflineScanStatus =
  | "PENDING_SYNC"
  | "CONFIRMED"
  | "CONFLICT"
  | "REJECTED";

export type StoredOfflineScan = {
  // Created once and reused for every upload retry.
  scanId: string;

  sessionId: string;
  scannerId: string;
  deviceId: string;
  mealId: string;

  // Taken from locally verified token claims.
  studentId: string;
  tokenId: string;
  tokenIssuedAt: number;
  tokenExpiresAt: number;

  // Preserve the original token for backend verification.
  token: string;

  // Estimated capture time using the server-time anchor.
  // This remains a device assertion.
  observedAt: string;

  status: OfflineScanStatus;
  syncAttempts: number;
  lastSyncAttemptAt: string | null;

  resultCode: string | null;
  resultMessage: string | null;
  redemptionId: string | null;
  syncedAt: string | null;
};

// Local duplicate protection must use meal + student,
// not token ID: a student can generate multiple QR tokens.
export type LocalCollectionMarker = {
  mealId: string;
  studentId: string;
  scanId: string;
  source: "ONLINE" | "OFFLINE";
  recordedAt: string;
};

export type OfflineSyncItem = {
  scanId: string;
  sessionId: string;
  deviceId: string;
  mealId: string;
  token: string;
  observedAt: string;
};

// Student identity is deliberately absent from the upload:
// the backend derives it from the verified token.
// Scanner identity comes from the authenticated session.
export type OfflineSyncRequest = {
  scans: OfflineSyncItem[];
};

export type OfflineSyncItemResult = {
  scanId: string;

  // RETRY leaves the local record pending.
  outcome:
    | "CONFIRMED"
    | "CONFLICT"
    | "REJECTED"
    | "RETRY";

  code: string;
  message: string;
  redemptionId: string | null;

  // True when this exact upload was already processed.
  replayed: boolean;
};

export type OfflineSyncResponse = {
  code: "OFFLINE_SYNC_RESULT";
  results: OfflineSyncItemResult[];
};

export type OfflineApiError = {
  code: string;
  message: string;
};