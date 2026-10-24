import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors } from "jose";

const TOKEN_ISSUER = "kamar-taj-refectory";
const TOKEN_AUDIENCE = "kamar-taj-meal-checkin";
const KEY_ID = "qr-key-v1";

const TOKEN_LIFETIME_SECONDS = 30;
const MAX_TOKEN_LENGTH = 2048;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MealTokenErrorCode =
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "SERVING_WINDOW_CLOSED";

export class MealTokenError extends Error {
  readonly code: MealTokenErrorCode;

  constructor(code: MealTokenErrorCode) {
    super(code);
    this.name = "MealTokenError";
    this.code = code;
  }
}

type CreateMealTokenInput = {
  studentId: string;
  mealSlotId: string;
  serveEnd: string;
};

export type VerifiedMealToken = {
  studentId: string;
  mealSlotId: string;
  tokenId: string;
  // These timestamps are Unix seconds.
  issuedAt: number;
  expiresAt: number;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function getSigningKey(): Uint8Array {
  const secret = process.env.QR_SIGNING_SECRET;

  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error(
      "QR_SIGNING_SECRET must contain exactly 64 hexadecimal characters."
    );
  }

  // Decode the generated hexadecimal secret into 32 bytes.
  return new Uint8Array(Buffer.from(secret, "hex"));
}

export async function createMealToken({
  studentId,
  mealSlotId,
  serveEnd,
}: CreateMealTokenInput): Promise<{
  token: string;
  expiresAt: string;
}> {
  if (!isUuid(studentId) || !isUuid(mealSlotId)) {
    throw new Error("Invalid student or meal ID supplied to token signer.");
  }

  const servingEndMilliseconds = Date.parse(serveEnd);

  if (!Number.isFinite(servingEndMilliseconds)) {
    throw new Error("Invalid serving end time supplied to token signer.");
  }

  const key = getSigningKey();
  const issuedAt = Math.floor(Date.now() / 1000);

  // A token must never outlive its meal's serving window.
  const expiresAt = Math.min(
    issuedAt + TOKEN_LIFETIME_SECONDS,
    Math.floor(servingEndMilliseconds / 1000)
  );

  if (expiresAt <= issuedAt) {
    throw new MealTokenError("SERVING_WINDOW_CLOSED");
  }

  const token = await new SignJWT({
    slot: mealSlotId,
  })
    .setProtectedHeader({
      alg: "HS256",
      typ: "JWT",
      kid: KEY_ID,
    })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(studentId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key);

  return {
    token,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyMealToken(
  token: unknown
): Promise<VerifiedMealToken> {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    throw new MealTokenError("INVALID_TOKEN");
  }

  // Keep configuration errors separate from invalid-token errors.
  const key = getSigningKey();

  try {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      typ: "JWT",
      requiredClaims: ["sub", "slot", "jti", "iat", "exp"],
      maxTokenAge: TOKEN_LIFETIME_SECONDS,
      clockTolerance: 0,
    });

    if (protectedHeader.kid !== KEY_ID) {
      throw new MealTokenError("INVALID_TOKEN");
    }

    const { sub, slot, jti, iat, exp } = payload;

    if (
      !isUuid(sub) ||
      !isUuid(slot) ||
      !isUuid(jti) ||
      typeof iat !== "number" ||
      typeof exp !== "number" ||
      !Number.isSafeInteger(iat) ||
      !Number.isSafeInteger(exp)
    ) {
      throw new MealTokenError("INVALID_TOKEN");
    }

    if (
      exp <= iat ||
      exp - iat > TOKEN_LIFETIME_SECONDS
    ) {
      throw new MealTokenError("INVALID_TOKEN");
    }

    return {
      studentId: sub,
      mealSlotId: slot,
      tokenId: jti,
      issuedAt: iat,
      expiresAt: exp,
    };
  } catch (error) {
    if (error instanceof MealTokenError) {
      throw error;
    }

    if (error instanceof errors.JWTExpired) {
      throw new MealTokenError("TOKEN_EXPIRED");
    }

    throw new MealTokenError("INVALID_TOKEN");
  }
}