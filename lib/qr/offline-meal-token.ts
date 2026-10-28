import "server-only";

import {
  importSPKI,
  jwtVerify,
  errors,
} from "jose";

import {
  getMealVerificationKey,
  type VerifiedMealToken,
} from "./meal-token";

const TOKEN_ISSUER = "kamar-taj-refectory";
const TOKEN_AUDIENCE = "kamar-taj-meal-checkin";

const TOKEN_LIFETIME_SECONDS = 30;
const MAX_TOKEN_LENGTH = 2048;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OfflineTokenErrorCode =
  | "INVALID_TOKEN"
  | "INVALID_SCAN_TIME"
  | "TOKEN_INVALID_AT_SCAN";

export class OfflineMealTokenError extends Error {
  constructor(readonly code: OfflineTokenErrorCode) {
    super(code);
    this.name = "OfflineMealTokenError";
  }
}

export type VerifiedOfflineMealToken =
  VerifiedMealToken & {
    keyId: string;
    observedAt: string;
  };

let cachedKey:
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

function parseObservedAt(value: unknown): Date {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      value
    )
  ) {
    throw new OfflineMealTokenError(
      "INVALID_SCAN_TIME"
    );
  }

  const date = new Date(value);

  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value ||
    date.getTime() < 0
  ) {
    throw new OfflineMealTokenError(
      "INVALID_SCAN_TIME"
    );
  }

  return date;
}

async function loadPublicKey(pem: string) {
  if (!cachedKey || cachedKey.pem !== pem) {
    cachedKey = {
      pem,
      promise: importSPKI(pem, "ES256"),
    };
  }

  try {
    return await cachedKey.promise;
  } catch (error) {
    cachedKey = undefined;
    throw error;
  }
}

export async function verifyOfflineUploadToken(
  token: unknown,
  observedAt: unknown
): Promise<VerifiedOfflineMealToken> {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    throw new OfflineMealTokenError("INVALID_TOKEN");
  }

  const observedDate = parseObservedAt(observedAt);

  // Only use the server-configured public key.
  // Never accept verification keys from the upload.
  const verification = await getMealVerificationKey();

  // Configuration errors remain server errors.
  const publicKey = await loadPublicKey(
    verification.publicKeyPem
  );

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

        // Validate token lifetime at the asserted capture
        // time. The database separately authorizes this
        // timestamp against the session and upload deadline.
        currentDate: observedDate,
      }
    );

    if (
      protectedHeader.alg !== "ES256" ||
      protectedHeader.kid !== verification.keyId
    ) {
      throw new OfflineMealTokenError(
        "INVALID_TOKEN"
      );
    }

    const { sub, slot, jti, iat, exp } = payload;

    if (
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
      throw new OfflineMealTokenError(
        "INVALID_TOKEN"
      );
    }

    const observedSeconds =
      observedDate.getTime() / 1000;

    if (
      iat > observedSeconds ||
      exp <= observedSeconds
    ) {
      throw new OfflineMealTokenError(
        "TOKEN_INVALID_AT_SCAN"
      );
    }

    return {
      studentId: sub.toLowerCase(),
      mealSlotId: slot.toLowerCase(),
      tokenId: jti.toLowerCase(),
      issuedAt: iat,
      expiresAt: exp,
      keyId: verification.keyId,
      observedAt: observedDate.toISOString(),
    };
  } catch (error) {
    if (error instanceof OfflineMealTokenError) {
      throw error;
    }

    if (error instanceof errors.JWTExpired) {
      throw new OfflineMealTokenError(
        "TOKEN_INVALID_AT_SCAN"
      );
    }

    throw new OfflineMealTokenError("INVALID_TOKEN");
  }
}