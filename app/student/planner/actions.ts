"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type {
  ActionResult,
  PlanInput,
  PlanPreview,
  PlanResult,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorMessages: Record<string, string> = {
  AUTH_REQUIRED: "Please log in again.",
  ACTIVE_STUDENT_REQUIRED:
    "An active student account is required.",
  INVALID_PLAN_DATES:
    "Choose today or a future date, up to 90 days inclusive, ending within the next 365 days.",
  INVALID_MEAL_TYPES:
    "Select breakfast, lunch, dinner, or a combination.",
  INVALID_MEAL_STATUS: "Choose opt in or opt out.",
  REQUEST_ID_REUSED:
    "This confirmation belongs to a different plan. Review the dates again.",
  REQUEST_ID_REQUIRED:
    "Review your plan before applying it.",
  PLAN_NOT_FOUND:
    "That plan could not be found in your account.",
};

function getErrorMessage(error: {
  message: string;
  code?: string;
}): string {
  if (error.code === "40P01" || error.code === "40001") {
    return "Another change was being processed. Please try again.";
  }

  return (
    errorMessages[error.message] ??
    "The plan could not be completed. Refresh and try again; if you were applying a plan, check its history first."
  );
}

function validInput(input: PlanInput): boolean {
  return Boolean(
    input &&
      typeof input.startDate === "string" &&
      typeof input.endDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) &&
      ["OPTED_IN", "OPTED_OUT"].includes(input.status) &&
      Array.isArray(input.mealTypes) &&
      input.mealTypes.length > 0 &&
      input.mealTypes.length <= 3 &&
      input.mealTypes.every((type) =>
        ["BREAKFAST", "LUNCH", "DINNER"].includes(type)
      )
  );
}

function getParameters(input: PlanInput) {
  return {
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_status: input.status,
    p_meal_types: input.mealTypes,
  };
}

function refreshPages() {
  const paths = [
    "/student",
    "/student/planner",
    "/student/qr",
    "/student/billing",
    "/student/billing/statement",
    "/admin",
    "/admin/analytics",
  ];

  for (const path of paths) {
    revalidatePath(path);
  }
}

export async function previewPlan(
  input: PlanInput
): Promise<ActionResult<PlanPreview>> {
  await requireRole("STUDENT");

  if (!validInput(input)) {
    return {
      success: false,
      message: "Choose valid dates, meals, and an action.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "preview_my_meal_plan",
    getParameters(input)
  );

  if (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }

  if (!data) {
    return {
      success: false,
      message: "The preview could not be loaded.",
    };
  }

  return {
    success: true,
    data: {
      ...(data as PlanPreview),
      request_id: randomUUID(),
    },
  };
}

export async function savePlan(
  input: PlanInput,
  requestId: string
): Promise<ActionResult<PlanResult>> {
  await requireRole("STUDENT");

  if (
    !validInput(input) ||
    typeof requestId !== "string" ||
    !UUID_PATTERN.test(requestId)
  ) {
    return {
      success: false,
      message: "Review a valid meal plan before applying it.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "save_my_meal_plan",
    {
      ...getParameters(input),
      p_request_id: requestId,
    }
  );

  if (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }

  if (!data) {
    return {
      success: false,
      message:
        "Could not confirm the result. Check history before starting a new plan.",
    };
  }

  refreshPages();

  return {
    success: true,
    data: data as PlanResult,
  };
}

export async function stopPlan(
  planId: string
): Promise<ActionResult<{ removed_slots: number }>> {
  await requireRole("STUDENT");

  if (
    typeof planId !== "string" ||
    !UUID_PATTERN.test(planId)
  ) {
    return {
      success: false,
      message: "Choose a valid plan.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "stop_my_meal_plan",
    {
      p_plan_id: planId,
    }
  );

  if (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }

  refreshPages();

  return {
    success: true,
    data: data as { removed_slots: number },
  };
}