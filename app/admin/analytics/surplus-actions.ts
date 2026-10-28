"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  isMealSurplusStatus,
  type MealSurplusActionState,
} from "@/lib/meal-surplus-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(
  value: string,
  minimum: number,
  maximum: number
): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;

  const number = Number(value);

  return Number.isSafeInteger(number) &&
    number >= minimum &&
    number <= maximum
    ? number
    : null;
}

// Interpret datetime-local input as IST.
// Accept optional seconds so existing deadlines can be preserved.
function parseIST(value: string): Date | null {
  if (
    !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(
      value
    )
  ) {
    return null;
  }

  const normalized =
    value.length === 16 ? `${value}:00` : value;

  const parsed = new Date(`${normalized}+05:30`);

  if (!Number.isFinite(parsed.getTime())) return null;

  const roundTrip = new Date(
    parsed.getTime() + 330 * 60 * 1000
  )
    .toISOString()
    .slice(0, 19);

  return roundTrip === normalized ? parsed : null;
}

const errorMessages: Record<string, string> = {
  AUTH_REQUIRED: "Please log in again.",
  ACTIVE_ADMIN_REQUIRED:
    "An active admin account is required.",
  INVALID_MEAL_ID: "Choose a valid meal.",
  MEAL_NOT_FOUND: "This meal could not be found.",
  INVALID_SURPLUS_PORTIONS:
    "Enter between 1 and 100,000 portions.",
  INVALID_COLLECTION_DEADLINE:
    "Enter a valid collection deadline in IST.",
  INVALID_SURPLUS_STATUS:
    "Choose a valid surplus status.",
  SURPLUS_TEXT_TOO_LONG:
    "Keep the recipient within 200 characters and notes within 1,000.",
  INVALID_SURPLUS_VERSION:
    "Refresh the page before saving this report.",
  RECIPIENT_REQUIRED:
    "Enter the recipient before assigning or confirming collection.",
  SURPLUS_SERVING_NOT_STARTED:
    "You can report surplus once serving begins.",
  SURPLUS_VERSION_CONFLICT:
    "This report changed. Refresh and review it before saving again.",
  SURPLUS_MUST_START_AVAILABLE:
    "Create the surplus report as Available first.",
  COLLECTION_DEADLINE_PASSED:
    "The collection deadline has passed. Close the batch as Discarded or Cancelled.",
  SURPLUS_ALREADY_CLOSED:
    "This batch is already closed and cannot be changed.",
  SURPLUS_ASSIGN_FIRST:
    "Assign the batch to a recipient before marking it collected.",
  SURPLUS_BATCH_DETAILS_LOCKED:
    "Quantity and deadline can only change while the batch remains Available. Save those edits separately.",
  SURPLUS_RECIPIENT_CHANGED:
    "Save the assigned recipient before confirming collection.",
  SURPLUS_CLOSURE_REASON_REQUIRED:
    "Enter a reason in Notes before discarding or cancelling.",
};

export async function saveMealSurplus(
  mealId: string,
  _previousState: MealSurplusActionState,
  formData: FormData
): Promise<MealSurplusActionState> {
  await requireRole("ADMIN");

  if (!UUID_PATTERN.test(mealId)) {
    return {
      success: false,
      message: "Invalid meal.",
    };
  }

  const portions = readInteger(
    readText(formData, "portions"),
    1,
    100000
  );

  const expectedVersion = readInteger(
    readText(formData, "expected_version"),
    0,
    2147483647
  );

  const status = readText(formData, "status");
  const deadline = parseIST(
    readText(formData, "collect_by")
  );

  const recipient = readText(formData, "recipient");
  const notes = readText(formData, "notes");

  if (portions === null) {
    return {
      success: false,
      message: errorMessages.INVALID_SURPLUS_PORTIONS,
    };
  }

  if (expectedVersion === null) {
    return {
      success: false,
      message: errorMessages.INVALID_SURPLUS_VERSION,
    };
  }

  if (!isMealSurplusStatus(status)) {
    return {
      success: false,
      message: errorMessages.INVALID_SURPLUS_STATUS,
    };
  }

  if (!deadline) {
    return {
      success: false,
      message: errorMessages.INVALID_COLLECTION_DEADLINE,
    };
  }

  if (recipient.length > 200 || notes.length > 1000) {
    return {
      success: false,
      message: errorMessages.SURPLUS_TEXT_TOO_LONG,
    };
  }

  if (
    (status === "ASSIGNED" || status === "COLLECTED") &&
    !recipient
  ) {
    return {
      success: false,
      message: errorMessages.RECIPIENT_REQUIRED,
    };
  }

  if (
    (status === "DISCARDED" || status === "CANCELLED") &&
    !notes
  ) {
    return {
      success: false,
      message: errorMessages.SURPLUS_CLOSURE_REASON_REQUIRED,
    };
  }

  const supabase = await createClient();

  // The database checks authorization, current time,
  // version conflicts, and allowed status changes.
  const { data, error } = await supabase.rpc(
    "save_meal_surplus",
    {
      p_meal_slot_id: mealId,
      p_portions: portions,
      p_collect_by: deadline.toISOString(),
      p_status: status,
      p_recipient: status === "AVAILABLE" ? "" : recipient,
      p_notes: notes,
      p_expected_version: expectedVersion,
    }
  );

  if (error) {
    const knownMessage = errorMessages[error.message];

    if (!knownMessage) {
      console.error("Surplus save failed:", error.code);
    }

    return {
      success: false,
      message:
        knownMessage ??
        "Could not confirm the save. Refresh and check the report before retrying.",
    };
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.meal_slot_id !== "string" ||
    data.meal_slot_id.toLowerCase() !== mealId.toLowerCase() ||
    data.status !== status ||
    !Number.isInteger(data.version) ||
    data.version < 1
  ) {
    return {
      success: false,
      message:
        "Could not confirm the saved report. Refresh and check before retrying.",
    };
  }

  revalidatePath("/admin/analytics");
  revalidatePath("/admin");

  const successMessages = {
    AVAILABLE: "Surplus saved as available for redistribution.",
    ASSIGNED: "Surplus assigned to the recipient.",
    COLLECTED: "Collection recorded. This batch is now closed.",
    DISCARDED: "Batch marked as discarded. Update measured waste separately.",
    CANCELLED: "Surplus report cancelled.",
  };

  return {
    success: true,
    message: successMessages[status],
  };
}