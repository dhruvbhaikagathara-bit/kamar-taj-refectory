import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  SignJWT,
  jwtVerify,
  decodeProtectedHeader,
  importPKCS8,
  importSPKI,
  errors,
} from "jose";

const TOKEN_ISSUER = "kamar-taj-refectory";
const TOKEN_AUDIENCE = "kamar-taj-meal-checkin";

const LEGACY_KEY_ID = "qr-key-v1";
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
  issuedAt: number;
  expiresAt: number;
};

let privateKeyPromise:
  | ReturnType<typeof importPKCS8>
  | undefined;

let publicKeyPromise:
  | ReturnType<typeof importSPKI>
  | undefined;

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value)
  );
}

function getKeyId(): string {
  const keyId = process.env.QR_SIGNING_KEY_ID?.trim();

  if (
    !keyId ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(keyId) ||
    keyId === LEGACY_KEY_ID
  ) {
    throw new Error(
      "QR_SIGNING_KEY_ID must be a valid, non-legacy key ID."
    );
  }

  return keyId;
}

function readPem(
  variable:
    | "QR_PRIVATE_KEY_BASE64"
    | "QR_PUBLIC_KEY_BASE64",
  expectedHeader: string
): string {
  const encoded = process.env[variable]?.trim();

  if (
    !encoded ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error(`${variable} is missing or invalid.`);
  }

  const pem = Buffer.from(encoded, "base64")
    .toString("utf8")
    .trim();

  if (!pem.startsWith(expectedHeader)) {
    throw new Error(
      `${variable} does not contain the expected PEM key.`
    );
  }

  return pem;
}

function getPrivateKey() {
  if (!privateKeyPromise) {
    const pem = readPem(
      "QR_PRIVATE_KEY_BASE64",
      "-----BEGIN PRIVATE KEY-----"
    );

    privateKeyPromise = importPKCS8(pem, "ES256").catch(
      (error: unknown) => {
        privateKeyPromise = undefined;
        throw error;
      }
    );
  }

  return privateKeyPromise;
}

function getPublicKey() {
  if (!publicKeyPromise) {
    const pem = readPem(
      "QR_PUBLIC_KEY_BASE64",
      "-----BEGIN PUBLIC KEY-----"
    );

    publicKeyPromise = importSPKI(pem, "ES256").catch(
      (error: unknown) => {
        publicKeyPromise = undefined;
        throw error;
      }
    );
  }

  return publicKeyPromise;
}

// Used only on the server to verify old HS256 passes.
// Never return this secret from an API.
function getLegacyKey(): Uint8Array {
  const secret = process.env.QR_SIGNING_SECRET;

  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error(
      "QR_SIGNING_SECRET must contain exactly 64 hexadecimal characters."
    );
  }

  return new Uint8Array(Buffer.from(secret, "hex"));
}

// A later preparation endpoint will expose only this
// public verification information to authorized scanners.
export async function getMealVerificationKey(): Promise<{
  algorithm: "ES256";
  keyId: string;
  publicKeyPem: string;
}> {
  const keyId = getKeyId();

  // Validate that the configured public key can be imported.
  await getPublicKey();

  return {
    algorithm: "ES256",
    keyId,
    publicKeyPem: readPem(
      "QR_PUBLIC_KEY_BASE64",
      "-----BEGIN PUBLIC KEY-----"
    ),
  };
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
    throw new Error(
      "Invalid student or meal ID supplied to token signer."
    );
  }

  const servingEndMilliseconds = Date.parse(serveEnd);

  if (!Number.isFinite(servingEndMilliseconds)) {
    throw new Error(
      "Invalid serving end time supplied to token signer."
    );
  }

  const keyId = getKeyId();
  const key = await getPrivateKey();

  const issuedAt = Math.floor(Date.now() / 1000);

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
      alg: "ES256",
      typ: "JWT",
      kid: keyId,
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

  let header: ReturnType<typeof decodeProtectedHeader>;

  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new MealTokenError("INVALID_TOKEN");
  }

  if (header.typ !== "JWT") {
    throw new MealTokenError("INVALID_TOKEN");
  }

  // The unverified header selects only one of our
  // explicitly configured algorithm/key combinations.
  // It never supplies a key or a remote key URL.
  const isLegacy =
    header.alg === "HS256" &&
    header.kid === LEGACY_KEY_ID;

  if (
    !isLegacy &&
    (
      header.alg !== "ES256" ||
      header.kid !== getKeyId()
    )
  ) {
    throw new MealTokenError("INVALID_TOKEN");
  }

  // Load keys outside the token-error handler so
  // configuration problems remain server errors.
  const key = isLegacy
    ? getLegacyKey()
    : await getPublicKey();

  const algorithm = isLegacy ? "HS256" : "ES256";

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [algorithm],
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
    });

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
      iat < 0 ||
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