import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentBillingMonth,
  isBillingMonth,
} from "@/lib/billing";

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
        message: "Please log in to view your rebates.",
      },
      401,
    );
  }

  const month =
    new URL(request.url).searchParams.get("month") ??
    getCurrentBillingMonth();

  if (!isBillingMonth(month)) {
    return respond(
      {
        code: "INVALID_MONTH",
        message: "Choose a month between January 2000 and December 2099.",
      },
      400,
    );
  }

  const { data, error } = await supabase.rpc(
    "get_my_monthly_rebates",
    { p_month: month },
  );

  if (error) {
    if (error.message === "ACTIVE_STUDENT_REQUIRED") {
      return respond(
        {
          code: "ACTIVE_STUDENT_REQUIRED",
          message: "An active student account is required.",
        },
        403,
      );
    }

    if (error.message === "AUTH_REQUIRED") {
      return respond(
        {
          code: "AUTH_REQUIRED",
          message: "Please log in again.",
        },
        401,
      );
    }

    return respond(
      {
        code: "BILLING_LOOKUP_FAILED",
        message: "Unable to load your rebate history. Please try again.",
      },
      500,
    );
  }

  if (!data) {
    return respond(
      {
        code: "BILLING_LOOKUP_FAILED",
        message: "Unable to load your rebate history. Please try again.",
      },
      500,
    );
  }

  return respond(data);
}