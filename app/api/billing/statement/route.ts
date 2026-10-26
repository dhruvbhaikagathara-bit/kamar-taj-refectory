import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getCurrentBillingMonth,
  isBillingMonth,
} from "@/lib/billing";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
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
    return json({ error: "AUTH_REQUIRED" }, 401);
  }

  const url = new URL(request.url);
  const months = url.searchParams.getAll("month");

  if (months.length > 1) {
    return json({ error: "INVALID_MONTH" }, 400);
  }

  const month = months[0] ?? getCurrentBillingMonth();

  if (!isBillingMonth(month)) {
    return json({ error: "INVALID_MONTH" }, 400);
  }

  const { data, error } = await supabase.rpc(
    "get_my_monthly_bill",
    { p_month: month },
  );

  if (error) {
    if (error.message.includes("ACTIVE_STUDENT_REQUIRED")) {
      return json({ error: "ACTIVE_STUDENT_REQUIRED" }, 403);
    }

    if (error.message.includes("AUTH_REQUIRED")) {
      return json({ error: "AUTH_REQUIRED" }, 401);
    }

    if (
      error.message.includes("BILLING_RECONCILIATION_REQUIRED")
    ) {
      return json(
        { error: "BILLING_RECONCILIATION_REQUIRED" },
        409,
      );
    }

    return json({ error: "BILLING_LOOKUP_FAILED" }, 500);
  }

  if (!data) {
    return json({ error: "BILLING_LOOKUP_FAILED" }, 500);
  }

  return json(data);
}