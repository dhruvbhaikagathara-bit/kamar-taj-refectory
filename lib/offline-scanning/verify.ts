import {
  importSPKI,
  jwtVerify,
  errors,
} from "jose";

import type {
  OfflineClockAnchor,
  StoredOfflinePreparation,
} from "./types";

const TOKEN_ISSUER = "kamar-taj-refectory";
const TOKEN_AUDIENCE = "kamar-taj-meal-checkin";

const TOKEN_LIFETIME_SECONDS = 30;
const MAX_TOKEN_LENGTH = 2048;
const MAX_PREPARATION_REQUEST_MS = 10000;
const MAX_CLOCK_DRIFT_MS = 2000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OfflineVerificationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OfflineVerificationError";
  }
}

export type VerifiedOfflineScan = {
  studentId: string;
  mealId: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
  observedAt: string;
};

// Anchors are valid only in this page's memory.
// Reloading requires a fresh online preparation.
const clockChecks = new WeakMap<
  OfflineClockAnchor,
  {
    wallClockMs: number;
    performanceMs: number;
  }
>();

let cachedPublicKey:
  | {
      pem: string;
      promise: ReturnType<typeof importSPKI>;
    }
  | undefined;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value)
  );
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    throw new OfflineVerificationError(
      "INVALID_PREPARATION",
      "The offline session contains an invalid timestamp."
    );
  }

  return parsed;
}

function validatePreparation(
  preparation: StoredOfflinePreparation
) {
  const { session, verification } = preparation;

  if (
    preparation.sessionId !== session.sessionId ||
    !isUuid(session.sessionId) ||
    !isUuid(session.scannerId) ||
    !isUuid(session.deviceId) ||
    !isUuid(session.mealId) ||
    verification.algorithm !== "ES256" ||
    verification.keyId !== session.keyId ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(session.keyId) ||
    session.keyId === "qr-key-v1" ||
    !verification.publicKeyPem.startsWith(
      "-----BEGIN PUBLIC KEY-----"
    ) ||
    !Array.isArray(session.eligibleStudentIds) ||
    session.eligibleStudentIds.length > 10000 ||
    !session.eligibleStudentIds.every(isUuid) ||
    session.eligibleCount !==
      session.eligibleStudentIds.length
  ) {
    throw new OfflineVerificationError(
      "INVALID_PREPARATION",
      "Offline preparation is invalid. Prepare again online."
    );
  }

  const preparedAt = timestamp(session.preparedAt);
  const serveStart = timestamp(session.serveStart);
  const serveEnd = timestamp(session.serveEnd);
  const captureStart = timestamp(session.captureStart);
  const captureEnd = timestamp(session.captureExpiresAt);
  const syncDeadline = timestamp(session.syncDeadline);
  const serverNow = timestamp(session.serverNow);

  if (
    serveEnd <= serveStart ||
    captureStart < preparedAt ||
    captureStart < serveStart ||
    captureEnd <= captureStart ||
    captureEnd > serveEnd ||
    captureEnd - captureStart > 15 * 60 * 1000 ||
    syncDeadline < captureEnd ||
    syncDeadline - captureEnd > 24 * 60 * 60 * 1000 ||
    serverNow < preparedAt ||
    serverNow >= captureEnd
  ) {
    throw new OfflineVerificationError(
      "INVALID_PREPARATION",
      "Offline session timing is invalid. Prepare again online."
    );
  }
}

async function getPublicKey(pem: string) {
  if (!cachedPublicKey || cachedPublicKey.pem !== pem) {
    cachedPublicKey = {
      pem,
      promise: importSPKI(pem, "ES256"),
    };
  }

  try {
    return await cachedPublicKey.promise;
  } catch {
    cachedPublicKey = undefined;

    throw new OfflineVerificationError(
      "INVALID_PUBLIC_KEY",
      "The verification key could not be loaded. Prepare again online."
    );
  }
}

// Call immediately after receiving a successful preparation
// response, using performance.now() captured before fetch.
export function createOfflineClockAnchor(
  preparation: StoredOfflinePreparation,
  requestStartedAt: number
): OfflineClockAnchor {
  validatePreparation(preparation);

  const receivedAt = performance.now();
  const requestDuration = receivedAt - requestStartedAt;

  if (
    !Number.isFinite(requestStartedAt) ||
    requestDuration < 0 ||
    requestDuration > MAX_PREPARATION_REQUEST_MS
  ) {
    throw new OfflineVerificationError(
      "PREPARATION_TOO_SLOW",
      "Preparation took too long to establish the scanner clock. Try again online."
    );
  }

  // Add the full request duration conservatively.
  // This may reject a nearly expired pass early rather
  // than extending its validity because of network delay.
  const estimatedServerNow =
    timestamp(preparation.session.serverNow) +
    requestDuration;

  if (
    estimatedServerNow >=
    timestamp(preparation.session.captureExpiresAt)
  ) {
    throw new OfflineVerificationError(
      "OFFLINE_SESSION_EXPIRED",
      "The offline session has expired."
    );
  }

  const anchor: OfflineClockAnchor = {
    sessionId: preparation.sessionId,
    serverEpochMs: estimatedServerNow,
    performanceMs: receivedAt,
  };

  clockChecks.set(anchor, {
    wallClockMs: Date.now(),
    performanceMs: receivedAt,
  });

  return anchor;
}

function estimatedServerTime(
  anchor: OfflineClockAnchor
): number {
  const check = clockChecks.get(anchor);

  if (!check) {
    throw new OfflineVerificationError(
      "CLOCK_NOT_READY",
      "Prepare offline scanning again after reloading the page."
    );
  }

  const currentPerformance = performance.now();
  const elapsed = currentPerformance - anchor.performanceMs;

  const wallElapsed = Date.now() - check.wallClockMs;
  const monotonicElapsed =
    currentPerformance - check.performanceMs;

  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    Math.abs(wallElapsed - monotonicElapsed) >
      MAX_CLOCK_DRIFT_MS
  ) {
    throw new OfflineVerificationError(
      "CLOCK_CHANGED",
      "The device clock changed or the device resumed with inconsistent timing. Reconnect and prepare again."
    );
  }

  return anchor.serverEpochMs + elapsed;
}

export async function verifyOfflineMealToken({
  token,
  preparation,
  anchor,
  scannerId,
  deviceId,
  selectedMealId,
}: {
  token: string;
  preparation: StoredOfflinePreparation;
  anchor: OfflineClockAnchor;
  scannerId: string;
  deviceId: string;
  selectedMealId: string;
}): Promise<VerifiedOfflineScan> {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    throw new OfflineVerificationError(
      "INVALID_TOKEN",
      "This QR pass is invalid."
    );
  }

  validatePreparation(preparation);

  const { session, verification } = preparation;

  if (
    anchor.sessionId !== session.sessionId ||
    session.scannerId !== scannerId ||
    session.deviceId !== deviceId ||
    session.mealId !== selectedMealId
  ) {
    throw new OfflineVerificationError(
      "SESSION_MISMATCH",
      "Prepare offline scanning for this account, device, and meal."
    );
  }

  const publicKey = await getPublicKey(
    verification.publicKeyPem
  );

  const observedMs = estimatedServerTime(anchor);
  const captureStart = timestamp(session.captureStart);
  const captureEnd = timestamp(session.captureExpiresAt);

  if (observedMs < captureStart) {
    throw new OfflineVerificationError(
      "OFFLINE_SESSION_NOT_STARTED",
      "This offline session has not started."
    );
  }

  if (observedMs >= captureEnd) {
    throw new OfflineVerificationError(
      "OFFLINE_SESSION_EXPIRED",
      "Offline scanning has expired. Reconnect and prepare again."
    );
  }

  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      publicKey,
      {
        algorithms: ["ES256"],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        typ: "JWT",
        requiredClaims: [
          "sub",
          "slot",
          "jti",
          "iat",
          "exp",
        ],
        maxTokenAge: TOKEN_LIFETIME_SECONDS,
        clockTolerance: 0,
        currentDate: new Date(observedMs),
      }
    );

    const { sub, slot, jti, iat, exp } = payload;

    if (
      protectedHeader.kid !== session.keyId ||
      !isUuid(sub) ||
      !isUuid(slot) ||
      !isUuid(jti) ||
      typeof iat !== "number" ||
      typeof exp !== "number" ||
      !Number.isSafeInteger(iat) ||
      !Number.isSafeInteger(exp) ||
      iat < 0 ||
      exp <= iat ||
      exp - iat > TOKEN_LIFETIME_SECONDS
    ) {
      throw new OfflineVerificationError(
        "INVALID_TOKEN",
        "This QR pass is invalid."
      );
    }

    const studentId = sub.toLowerCase();
    const mealId = slot.toLowerCase();

    if (mealId !== selectedMealId.toLowerCase()) {
      throw new OfflineVerificationError(
        "WRONG_MEAL",
        "This QR belongs to a different meal."
      );
    }

    if (exp * 1000 > timestamp(session.serveEnd)) {
      throw new OfflineVerificationError(
        "INVALID_TOKEN",
        "This pass extends beyond the prepared serving window."
      );
    }

    if (
      !session.eligibleStudentIds.includes(studentId)
    ) {
      throw new OfflineVerificationError(
        "NOT_IN_OFFLINE_ROSTER",
        "This student is not in the downloaded eligible list. Reconnect to check online."
      );
    }

    // Recheck after signature verification in case it
    // took long enough for the token/session to expire.
    const finishedMs = estimatedServerTime(anchor);

    if (finishedMs >= captureEnd) {
      throw new OfflineVerificationError(
        "OFFLINE_SESSION_EXPIRED",
        "Offline scanning has expired. Reconnect and prepare again."
      );
    }

    if (finishedMs >= exp * 1000) {
      throw new OfflineVerificationError(
        "TOKEN_EXPIRED",
        "This QR has expired. Ask for a refreshed pass."
      );
    }

    return {
      studentId,
      mealId,
      tokenId: jti.toLowerCase(),
      issuedAt: iat,
      expiresAt: exp,
      observedAt: new Date(observedMs).toISOString(),
    };
  } catch (error) {
    if (error instanceof OfflineVerificationError) {
      throw error;
    }

    if (error instanceof errors.JWTExpired) {
      throw new OfflineVerificationError(
        "TOKEN_EXPIRED",
        "This QR has expired. Ask for a refreshed pass."
      );
    }

    throw new OfflineVerificationError(
      "INVALID_TOKEN",
      "This pass could not be verified offline. Use a fresh QR or reconnect."
    );
  }
}