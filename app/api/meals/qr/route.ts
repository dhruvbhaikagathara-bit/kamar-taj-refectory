import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createMealToken,
  MealTokenError,
} from "@/lib/qr/meal-token";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return respond(
      {
        code: "AUTH_REQUIRED",
        message: "Please log in to view your meal pass.",
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
        code: "PROFILE_LOOKUP_FAILED",
        message: "Unable to check your account. Please try again.",
      },
      500
    );
  }

  if (
    !profile ||
    profile.role !== "STUDENT" ||
    profile.account_status !== "ACTIVE"
  ) {
    return respond(
      {
        code: "ACTIVE_STUDENT_REQUIRED",
        message: "An active student account is required.",
      },
      403
    );
  }

  const mealId = new URL(request.url).searchParams.get("mealId");

  if (!mealId || !UUID_PATTERN.test(mealId)) {
    return respond(
      {
        code: "INVALID_MEAL_ID",
        message: "Choose a valid meal.",
      },
      400
    );
  }

  const [mealResult, enrollmentResult, redemptionResult] =
    await Promise.all([
      supabase
        .from("meal_slots")
        .select("id, serve_start, serve_end")
        .eq("id", mealId)
        .maybeSingle(),

      supabase
        .from("meal_enrollments")
        .select("status")
        .eq("student_id", user.id)
        .eq("meal_slot_id", mealId)
        .maybeSingle(),

      supabase
        .from("meal_redemptions")
        .select("id")
        .eq("student_id", user.id)
        .eq("meal_slot_id", mealId)
        .maybeSingle(),
    ]);

  if (
    mealResult.error ||
    enrollmentResult.error ||
    redemptionResult.error
  ) {
    return respond(
      {
        code: "ELIGIBILITY_CHECK_FAILED",
        message: "Unable to check meal eligibility. Please try again.",
      },
      500
    );
  }

  const meal = mealResult.data;

  if (!meal) {
    return respond(
      {
        code: "MEAL_NOT_FOUND",
        message: "This meal could not be found.",
      },
      404
    );
  }

  if (enrollmentResult.data?.status !== "OPTED_IN") {
    return respond(
      {
        code: "NOT_OPTED_IN",
        message: "You must be opted in to receive this meal.",
      },
      409
    );
  }

  if (redemptionResult.data) {
    return respond(
      {
        code: "ALREADY_REDEEMED",
        message: "You have already collected this meal.",
      },
      409
    );
  }

  const now = Date.now();

  if (now < Date.parse(meal.serve_start)) {
    return respond(
      {
        code: "SERVING_NOT_STARTED",
        message: "Your QR pass becomes available when serving starts.",
      },
      409
    );
  }

  if (now >= Date.parse(meal.serve_end)) {
    return respond(
      {
        code: "SERVING_WINDOW_CLOSED",
        message: "The serving window for this meal has ended.",
      },
      409
    );
  }

  try {
    const pass = await createMealToken({
      studentId: user.id,
      mealSlotId: meal.id,
      serveEnd: meal.serve_end,
    });

    return respond({
      token: pass.token,
      expiresAt: pass.expiresAt,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    if (
      error instanceof MealTokenError &&
      error.code === "SERVING_WINDOW_CLOSED"
    ) {
      return respond(
        {
          code: error.code,
          message: "The serving window for this meal has ended.",
        },
        409
      );
    }

    return respond(
      {
        code: "TOKEN_CREATION_FAILED",
        message: "Unable to create your meal pass. Please try again.",
      },
      500
    );
  }
}