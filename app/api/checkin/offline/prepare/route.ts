import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMealVerificationKey } from "@/lib/qr/meal-token";


const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const preparationErrors: Record<
  string,
  { status: number; message: string }
> = {
  AUTH_REQUIRED: {
    status: 401,
    message: "Please log in as scanner staff.",
  },
  ACTIVE_SCANNER_REQUIRED: {
    status: 403,
    message: "An active scanner account is required.",
  },
  INVALID_DEVICE_ID: {
    status: 400,
    message: "The scanner device ID is invalid.",
  },
  MEAL_NOT_FOUND: {
    status: 404,
    message: "This meal could not be found.",
  },
  INVALID_SIGNING_KEY: {
    status: 500,
    message: "QR verification is not configured correctly.",
  },
  INVALID_MEAL_WINDOW: {
    status: 409,
    message: "This meal has an invalid serving schedule.",
  },
  MEAL_CHOICES_STILL_OPEN: {
    status: 409,
    message:
      "Offline scanning can be prepared after the meal-choice cutoff.",
  },
  SERVING_NOT_STARTED: {
    status: 409,
    message:
      "Wait until serving starts before preparing offline scanning.",
  },
  SERVING_WINDOW_CLOSED: {
    status: 409,
    message: "Serving has ended for this meal.",
  },
  PREPARATION_RATE_LIMITED: {
    status: 429,
    message:
      "Too many preparation requests. Wait one minute and try again.",
  },
  OFFLINE_ROSTER_TOO_LARGE: {
    status: 409,
    message:
      "This meal exceeds the offline roster limit. Continue using online scanning.",
  },
  OFFLINE_SESSION_EXPIRED: {
    status: 409,
    message:
      "The offline session expired during preparation. Check the serving window and try again.",
  },
};

function respond(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
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

      if (totalBytes > 2048) {
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value)
  );
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

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
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
        message: "Send the preparation request as JSON.",
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
          message: "Please log in as scanner staff.",
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
            "Unable to check your account. Please try again.",
        },
        500
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
          message:
            "An active scanner account is required.",
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
            ? "The preparation request is too large."
            : "The preparation request could not be read.",
        },
        tooLarge ? 413 : 400
      );
    }

    if (
      !isRecord(body) ||
      !isUuid(body.mealId) ||
      !isUuid(body.deviceId)
    ) {
      return respond(
        {
          code: "INVALID_REQUEST",
          message: "Provide a valid meal ID and device ID.",
        },
        400
      );
    }

    const mealId = body.mealId.toLowerCase();
    const deviceId = body.deviceId.toLowerCase();

    // Only public verification information is returned.
    const verification = await getMealVerificationKey();

    const admin = createAdminClient();

    const { data, error } = await admin.rpc(
      "prepare_offline_scan_session",
      {
        // Never accept scanner identity from the browser.
        p_scanner_id: user.id,
        p_device_id: deviceId,
        p_meal_slot_id: mealId,
        p_signing_key_id: verification.keyId,
      }
    );

    if (error) {
      const known = preparationErrors[error.message];

      if (known) {
        return respond(
          {
            code: error.message,
            message: known.message,
          },
          known.status
        );
      }

      if (
        error.code === "40P01" ||
        error.code === "40001"
      ) {
        return respond(
          {
            code: "RETRY_REQUIRED",
            message:
              "Another operation was being processed. Try preparing again.",
          },
          409
        );
      }

      console.error(
        "Offline preparation database error:",
        error.code
      );

      return respond(
        {
          code: "PREPARATION_FAILED",
          message:
            "Unable to prepare offline scanning. Continue online and try again.",
        },
        500
      );
    }

    // Validate the response before delivering a roster.
    if (
      !isRecord(data) ||
      !isUuid(data.session_id) ||
      data.scanner_id !== user.id ||
      data.device_id !== deviceId ||
      data.meal_slot_id !== mealId ||
      data.signing_key_id !== verification.keyId ||
      !isTimestamp(data.prepared_at) ||
      !isTimestamp(data.serve_start) ||
      !isTimestamp(data.serve_end) ||
      !isTimestamp(data.capture_start) ||
      !isTimestamp(data.capture_expires_at) ||
      !isTimestamp(data.sync_deadline) ||
      !isTimestamp(data.server_now) ||
      !Array.isArray(data.eligible_student_ids) ||
      data.eligible_student_ids.length > 10000 ||
      !data.eligible_student_ids.every(isUuid) ||
      data.eligible_count !==
        data.eligible_student_ids.length
    ) {
      return respond(
        {
          code: "PREPARATION_UNCONFIRMED",
          message:
            "The offline preparation could not be confirmed. Continue using online scanning.",
        },
        500
      );
    }

    return respond({
      code: "OFFLINE_PREPARED",
      message:
        "Offline session prepared. Download and save it on this scanner before disconnecting.",

      session: {
        sessionId: data.session_id,
        scannerId: data.scanner_id,
        deviceId: data.device_id,
        mealId: data.meal_slot_id,
        keyId: data.signing_key_id,
        preparedAt: data.prepared_at,
        serveStart: data.serve_start,
        serveEnd: data.serve_end,
        captureStart: data.capture_start,
        captureExpiresAt: data.capture_expires_at,
        syncDeadline: data.sync_deadline,
        serverNow: data.server_now,
        eligibleStudentIds: data.eligible_student_ids,
        eligibleCount: data.eligible_count,
      },

      verification: {
        algorithm: verification.algorithm,
        keyId: verification.keyId,
        publicKeyPem: verification.publicKeyPem,
      },
    });
  } catch (error) {
    console.error(
      "Offline preparation server error:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return respond(
      {
        code: "SERVER_ERROR",
        message:
          "Unable to prepare offline scanning. Check the server configuration and try again.",
      },
      500
    );
  }
}