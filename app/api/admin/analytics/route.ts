import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getIndiaDate,
  isAnalyticsDate,
} from "@/lib/meal-analytics";

function respond(body: unknown, status = 200) {
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
        message: "Please log in.",
      },
      401,
    );
  }

  const date =
    new URL(request.url).searchParams.get("date") ??
    getIndiaDate();

  if (!isAnalyticsDate(date)) {
    return respond(
      {
        code: "INVALID_DATE",
        message: "Choose a valid date between 2000 and 2099.",
      },
      400,
    );
  }

  const { data, error } = await supabase.rpc(
    "get_admin_meal_analytics",
    { p_meal_date: date },
  );

  if (error) {
    if (error.message === "ACTIVE_ADMIN_REQUIRED") {
      return respond(
        {
          code: "ACTIVE_ADMIN_REQUIRED",
          message: "An active admin account is required.",
        },
        403,
      );
    }

    return respond(
      {
        code: "ANALYTICS_LOOKUP_FAILED",
        message: "Unable to load meal analytics.",
      },
      500,
    );
  }

  return respond({
    date,
    meals: data ?? [],
  });
}