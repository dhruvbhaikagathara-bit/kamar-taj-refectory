import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OfflineMealTokenError,
  verifyOfflineUploadToken,
} from "@/lib/qr/offline-meal-token";
import type {
  OfflineSyncItem,
  OfflineSyncItemResult,
} from "@/lib/offline-scanning/types";



const MAX_BATCH_SIZE = 20;
const MAX_BODY_BYTES = 65536;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const messages: Record<string, string> = {
  CHECKIN_ACCEPTED: "Offline collection confirmed.",
  CHECKIN_ALREADY_RECORDED:
    "This collection was already recorded.",
  ALREADY_REDEEMED:
    "Another scan already recorded this student's collection.",
  INVALID_TOKEN: "The QR signature or token is invalid.",
  INVALID_SCAN_TIME: "The recorded scan time is invalid.",
  TOKEN_INVALID_AT_SCAN:
    "The QR was not valid at the reported scan time.",
  WRONG_MEAL: "The QR belongs to a different meal.",
  OFFLINE_SESSION_NOT_FOUND:
    "The offline session could not be found.",
  OFFLINE_SESSION_MISMATCH:
    "The scan does not match this staff account, device, or meal.",
  OFFLINE_SESSION_REVOKED:
    "This offline session has been revoked.",
  OFFLINE_SYNC_DEADLINE_PASSED:
    "The upload deadline has passed. Ask an administrator to review this collection.",
  OUTSIDE_OFFLINE_WINDOW:
    "The reported scan time is outside the offline session.",
  OUTSIDE_SERVING_WINDOW:
    "The reported scan time is outside serving hours.",
  MEAL_SCHEDULE_CHANGED:
    "The serving schedule changed after preparation. Administrator review is needed.",
  NOT_IN_OFFLINE_ROSTER:
    "The student was not in this session's eligible list.",
  ACTIVE_STUDENT_REQUIRED:
    "The student account is no longer active.",
  STUDENT_NOT_FOUND:
    "The student account could not be found.",
  NOT_OPTED_IN:
    "The student is not currently opted in to this meal.",
  MEAL_NOT_FOUND: "The meal could not be found.",
  SCAN_ID_REUSED:
    "This scan ID was already used with different data.",
  INVALID_SYNC_REQUEST:
    "The scan contains invalid synchronization data.",
  SCAN_TIME_AHEAD:
    "The scanner time is slightly ahead. Retry synchronization shortly.",
  ACTIVE_SCANNER_REQUIRED:
    "An active scanner account is required. Sign in again before syncing.",
  SYNC_RETRY:
    "Synchronization could not be confirmed. This scan remains pending.",
};

const permanentDatabaseErrors = new Set([
  "INVALID_SYNC_REQUEST",
  "OFFLINE_SESSION_NOT_FOUND",
  "OFFLINE_SESSION_MISMATCH",
  "STUDENT_NOT_FOUND",
  "MEAL_NOT_FOUND",
  "SCAN_ID_REUSED",
]);

function respond(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

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

function isSyncItem(value: unknown): value is OfflineSyncItem {
  return (
    isRecord(value) &&
    isUuid(value.scanId) &&
    isUuid(value.sessionId) &&
    isUuid(value.deviceId) &&
    isUuid(value.mealId) &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    value.token.length <= 2048 &&
    typeof value.observedAt === "string" &&
    value.observedAt.length <= 40
  );
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();

  if (!reader) {
    throw new Error("EMPTY_BODY");
  }

  const decoder = new TextDecoder("utf-8", {
    fatal: true,
  });

  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }

      text += decoder.decode(value, {
        stream: true,
      });
    }

    text += decoder.decode();

    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

function itemResult(
  scanId: string,
  outcome: OfflineSyncItemResult["outcome"],
  code: string,
  redemptionId: string | null = null,
  replayed = false
): OfflineSyncItemResult {
  return {
    scanId,
    outcome,
    code,
    message: messages[code] ?? messages.SYNC_RETRY,
    redemptionId,
    replayed,
  };
}

// Generate this fingerprint on the server.
// Never trust a fingerprint supplied by the browser.
function requestFingerprint(
  scannerId: string,
  item: OfflineSyncItem,
  observedAt: string
): string {
  const canonical = JSON.stringify([
    "offline-scan-v1",
    scannerId.toLowerCase(),
    item.scanId.toLowerCase(),
    item.sessionId.toLowerCase(),
    item.deviceId.toLowerCase(),
    item.mealId.toLowerCase(),
    item.token,
    observedAt,
  ]);

  return createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  if (
    !origin ||
    origin !== new URL(request.url).origin
  ) {
    return respond(
      {
        code: "INVALID_ORIGIN",
        message: "This request is not allowed.",
      },
      403
    );
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return respond(
      {
        code: "INVALID_CONTENT_TYPE",
        message: "Send queued scans as JSON.",
      },
      415
    );
  }

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return respond(
        {
          code: "AUTH_REQUIRED",
          message:
            "Sign in as the original scanner staff account to sync pending scans.",
        },
        401
      );
    }

    const {
      data: profile,
      error: profileError,
    } = await supabase
      .from("profiles")
      .select("role, account_status")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return respond(
        {
          code: "ACCOUNT_CHECK_FAILED",
          message:
            "Unable to check your account. Pending scans should be retried.",
        },
        503
      );
    }

    if (
      !profile ||
      profile.role !== "SCANNER_STAFF" ||
      profile.account_status !== "ACTIVE"
    ) {
      return respond(
        {
          code: "ACTIVE_SCANNER_REQUIRED",
          message: messages.ACTIVE_SCANNER_REQUIRED,
        },
        403
      );
    }

    let body: unknown;

    try {
      body = await readBody(request);
    } catch (error) {
      const tooLarge =
        error instanceof Error &&
        error.message === "BODY_TOO_LARGE";

      return respond(
        {
          code: tooLarge
            ? "BODY_TOO_LARGE"
            : "INVALID_REQUEST",
          message: tooLarge
            ? "The sync request is too large."
            : "The sync request could not be read.",
        },
        tooLarge ? 413 : 400
      );
    }

    if (
      !isRecord(body) ||
      !Array.isArray(body.scans) ||
      body.scans.length === 0 ||
      body.scans.length > MAX_BATCH_SIZE ||
      !body.scans.every(isSyncItem)
    ) {
      return respond(
        {
          code: "INVALID_REQUEST",
          message:
            "Provide between 1 and 20 valid queued scans.",
        },
        400
      );
    }

    const scans: OfflineSyncItem[] = body.scans;

    const uniqueIds = new Set(
      scans.map((scan) => scan.scanId.toLowerCase())
    );

    if (uniqueIds.size !== scans.length) {
      return respond(
        {
          code: "DUPLICATE_SCAN_IDS",
          message:
            "Each scan ID must appear only once in a batch.",
        },
        400
      );
    }

    const admin = createAdminClient();

    const results: OfflineSyncItemResult[] = [];

    // Process sequentially to keep database contention low.
    // Each RPC commits independently and is safe to retry.
    for (const item of scans) {
      try {
        const verified = await verifyOfflineUploadToken(
          item.token,
          item.observedAt
        );

        if (
          verified.mealSlotId !== item.mealId.toLowerCase()
        ) {
          results.push(
            itemResult(
              item.scanId,
              "REJECTED",
              "WRONG_MEAL"
            )
          );
          continue;
        }

        const fingerprint = requestFingerprint(
          user.id,
          item,
          verified.observedAt
        );

        const { data, error } = await admin.rpc(
          "sync_verified_offline_scan",
          {
            p_scanner_id: user.id,
            p_device_id: item.deviceId.toLowerCase(),
            p_session_id: item.sessionId.toLowerCase(),
            p_scan_id: item.scanId.toLowerCase(),
            p_meal_slot_id: verified.mealSlotId,
            p_student_id: verified.studentId,
            p_token_jti: verified.tokenId,
            p_token_issued_at: verified.issuedAt,
            p_token_expires_at: verified.expiresAt,
            p_signing_key_id: verified.keyId,
            p_observed_at: verified.observedAt,
            p_request_sha256: fingerprint,
          }
        );

        if (error) {
          if (permanentDatabaseErrors.has(error.message)) {
            results.push(
              itemResult(
                item.scanId,
                "REJECTED",
                error.message
              )
            );
          } else if (
            error.message === "ACTIVE_SCANNER_REQUIRED"
          ) {
            results.push(
              itemResult(
                item.scanId,
                "RETRY",
                "ACTIVE_SCANNER_REQUIRED"
              )
            );
          } else {
            console.error(
              "Offline sync database error:",
              error.code
            );

            results.push(
              itemResult(
                item.scanId,
                "RETRY",
                "SYNC_RETRY"
              )
            );
          }

          continue;
        }

        if (
          !isRecord(data) ||
          data.scan_id !== item.scanId.toLowerCase() ||
          typeof data.code !== "string" ||
          typeof data.replayed !== "boolean" ||
          (
            data.outcome !== "CONFIRMED" &&
            data.outcome !== "CONFLICT" &&
            data.outcome !== "REJECTED" &&
            data.outcome !== "RETRY"
          ) ||
          (
            data.redemption_id !== null &&
            !isUuid(data.redemption_id)
          ) ||
          (
            data.outcome === "CONFIRMED" &&
            !isUuid(data.redemption_id)
          )
        ) {
          results.push(
            itemResult(
              item.scanId,
              "RETRY",
              "SYNC_RETRY"
            )
          );
          continue;
        }

        results.push(
          itemResult(
            item.scanId,
            data.outcome,
            data.code,
            data.redemption_id,
            data.replayed
          )
        );
      } catch (error) {
        if (error instanceof OfflineMealTokenError) {
          results.push(
            itemResult(
              item.scanId,
              "REJECTED",
              error.code
            )
          );
        } else {
          // A configuration or infrastructure failure
          // must not permanently discard a queued scan.
          console.error(
            "Offline sync verification error:",
            error instanceof Error
              ? error.name
              : "UnknownError"
          );

          results.push(
            itemResult(
              item.scanId,
              "RETRY",
              "SYNC_RETRY"
            )
          );
        }
      }
    }

    return respond({
      code: "OFFLINE_SYNC_RESULT",
      results,
    });
  } catch (error) {
    console.error(
      "Offline sync server error:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return respond(
      {
        code: "SERVER_ERROR",
        message:
          "Synchronization could not be confirmed. Keep pending scans and retry.",
      },
      503
    );
  }
}