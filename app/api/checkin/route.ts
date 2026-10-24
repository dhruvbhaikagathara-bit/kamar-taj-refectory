import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyMealToken,
  MealTokenError,
} from "@/lib/qr/meal-token";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rejectionMessages = new Map<string, string>([
  ["ACTIVE_STUDENT_REQUIRED", "The student account is not active."],
  ["ACTIVE_SCANNER_REQUIRED", "An active scanner account is required."],
  ["MEAL_NOT_FOUND", "This meal could not be found."],
  ["NOT_OPTED_IN", "The student has not opted in to this meal."],
  ["TOKEN_EXPIRED", "This QR has expired. Ask for a refreshed pass."],
  ["INVALID_TOKEN", "This QR pass is invalid."],
  ["SERVING_NOT_STARTED", "Serving has not started for this meal."],
  ["SERVING_WINDOW_CLOSED", "Serving has ended for this meal."],
  ["ALREADY_REDEEMED", "This student has already collected this meal."],
]);

function respond(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

// Bound the request body before parsing it.
async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();

  if (!reader) {
    throw new Error("EMPTY_BODY");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > 4096) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();

    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  if (origin && origin !== new URL(request.url).origin) {
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
        message: "Send the scan as JSON.",
      },
      415
    );
  }

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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return respond(
      {
        code: "ACCOUNT_CHECK_FAILED",
        message: "Unable to check your account. Please try again.",
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
        message: "An active scanner account is required.",
      },
      403
    );
  }

  let body: unknown;

  try {
    body = await readBody(request);
  } catch (error) {
    const tooLarge =
      error instanceof Error && error.message === "BODY_TOO_LARGE";

    return respond(
      {
        code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_REQUEST",
        message: tooLarge
          ? "The scan request is too large."
          : "The scan request could not be read.",
      },
      tooLarge ? 413 : 400
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond(
      {
        code: "INVALID_REQUEST",
        message: "Provide a QR token and selected meal.",
      },
      400
    );
  }

  const { token, mealId } = body as {
    token?: unknown;
    mealId?: unknown;
  };

  if (typeof mealId !== "string" || !UUID_PATTERN.test(mealId)) {
    return respond(
      {
        code: "INVALID_MEAL_ID",
        message: "Select the meal you are serving.",
      },
      400
    );
  }

  try {
    // Verify the signature and expiry BEFORE using token claims.
    const verified = await verifyMealToken(token);

    if (
      verified.mealSlotId.toLowerCase() !== mealId.toLowerCase()
    ) {
      return respond(
        {
          code: "WRONG_MEAL",
          message: "This QR belongs to a different meal.",
        },
        409
      );
    }

    const admin = createAdminClient();

    const { data, error } = await admin.rpc(
      "redeem_verified_meal",
      {
        // Scanner identity comes from the verified login session.
        p_scanner_id: user.id,

        // Student identity comes from the verified QR token.
        p_student_id: verified.studentId,
        p_meal_slot_id: verified.mealSlotId,
        p_token_jti: verified.tokenId,
        p_token_issued_at: verified.issuedAt,
        p_token_expires_at: verified.expiresAt,
      }
    );

    if (error) {
      const message = rejectionMessages.get(error.message);

      if (message) {
        return respond(
          {
            code: error.message,
            message,
          },
          409
        );
      }

      console.error("Check-in database error:", error.code);

      return respond(
        {
          code: "CHECKIN_FAILED",
          message:
            "Unable to confirm collection. Check the redemption record before serving.",
        },
        500
      );
    }

    if (!data || data.code !== "CHECKIN_ACCEPTED") {
      return respond(
        {
          code: "CHECKIN_UNCONFIRMED",
          message:
            "Unable to confirm collection. Check the redemption record before serving.",
        },
        500
      );
    }

    return respond({
      code: "CHECKIN_ACCEPTED",
      message: "Meal accepted.",
      redemptionId: data.redemption_id,
      studentName: data.student_name,
      mealSlotId: data.meal_slot_id,
      redeemedAt: data.redeemed_at,
    });
  } catch (error) {
    if (error instanceof MealTokenError) {
      return respond(
        {
          code: error.code,
          message:
            rejectionMessages.get(error.code) ??
            "This QR pass is invalid.",
        },
        error.code === "TOKEN_EXPIRED" ? 410 : 400
      );
    }

    console.error(
      "Check-in server error:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return respond(
      {
        code: "SERVER_ERROR",
        message: "Unable to process this scan. Please try again.",
      },
      500
    );
  }
}