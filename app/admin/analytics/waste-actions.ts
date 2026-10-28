"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type {
  MealWasteInput,
  MealWasteReport,
  MealWasteSaveResult,
} from "@/lib/meal-waste-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorMessages: Record<string, string> = {
  AUTH_REQUIRED: "Please log in again.",

  ACTIVE_ADMIN_REQUIRED:
    "An active administrator account is required.",

  MEAL_NOT_FOUND:
    "This meal could not be found. Refresh the page.",

  INVALID_PREPARED_PORTIONS:
    "Enter a whole number of prepared portions between 0 and 100,000.",

  INVALID_LEFTOVER_PORTIONS:
    "Leftover portions must be between zero and the prepared portions.",

  INVALID_WASTE_WEIGHT:
    "Enter a valid discarded food weight with at most three decimal places.",

  WASTE_WITHOUT_PREPARATION:
    "Discarded food weight must be zero when no portions were prepared.",

  WASTE_NOTES_TOO_LONG:
    "Keep your notes within 1,000 characters.",

  INVALID_REPORT_VERSION:
    "Refresh the page before saving this report.",

  MEAL_STILL_SERVING:
    "You can record final waste measurements after serving ends.",

  WASTE_REPORT_CHANGED:
    "Another administrator changed this report. Refresh the page and review their changes before saving.",
};

function parsePortions(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!/^\d{1,6}$/.test(text)) {
    return null;
  }

  const portions = Number(text);

  if (
    !Number.isSafeInteger(portions) ||
    portions > 100000
  ) {
    return null;
  }

  return portions;
}

function parseKilograms(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!/^\d{1,6}(?:\.\d{1,3})?$/.test(text)) {
    return null;
  }

  // Convert using integer arithmetic to avoid rounding
  // errors from multiplying decimal kilograms.
  const [whole, fraction = ""] = text.split(".");

  const grams =
    Number(whole) * 1000 +
    Number(fraction.padEnd(3, "0"));

  if (
    !Number.isSafeInteger(grams) ||
    grams > 100000000
  ) {
    return null;
  }

  return grams;
}

function isWasteReport(
  value: unknown
): value is MealWasteReport {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const report = value as Record<string, unknown>;

  const isInteger = (number: unknown) =>
    typeof number === "number" &&
    Number.isSafeInteger(number) &&
    number >= 0;

  return (
    typeof report.meal_slot_id === "string" &&
    isInteger(report.prepared_portions) &&
    isInteger(report.leftover_portions) &&
    isInteger(report.waste_grams) &&
    typeof report.notes === "string" &&
    isInteger(report.version) &&
    Number(report.version) > 0 &&
    typeof report.created_by === "string" &&
    typeof report.updated_by === "string" &&
    typeof report.created_at === "string" &&
    typeof report.updated_at === "string"
  );
}

export async function saveMealWasteReport(
  input: MealWasteInput
): Promise<MealWasteSaveResult> {
  await requireRole("ADMIN");

  if (
    !input ||
    typeof input.mealId !== "string" ||
    !UUID_PATTERN.test(input.mealId)
  ) {
    return {
      success: false,
      code: "MEAL_NOT_FOUND",
      message: "Choose a valid meal.",
    };
  }

  const prepared = parsePortions(
    input.preparedPortions
  );

  if (prepared === null) {
    return {
      success: false,
      code: "INVALID_PREPARED_PORTIONS",
      message: errorMessages.INVALID_PREPARED_PORTIONS,
    };
  }

  const leftover = parsePortions(
    input.leftoverPortions
  );

  if (
    leftover === null ||
    leftover > prepared
  ) {
    return {
      success: false,
      code: "INVALID_LEFTOVER_PORTIONS",
      message: errorMessages.INVALID_LEFTOVER_PORTIONS,
    };
  }

  const wasteGrams = parseKilograms(input.wasteKg);

  if (wasteGrams === null) {
    return {
      success: false,
      code: "INVALID_WASTE_WEIGHT",
      message: errorMessages.INVALID_WASTE_WEIGHT,
    };
  }

  if (prepared === 0 && wasteGrams > 0) {
    return {
      success: false,
      code: "WASTE_WITHOUT_PREPARATION",
      message: errorMessages.WASTE_WITHOUT_PREPARATION,
    };
  }

  if (typeof input.notes !== "string") {
    return {
      success: false,
      message: "Enter valid report notes.",
    };
  }

  const notes = input.notes.trim();

  if (notes.length > 1000) {
    return {
      success: false,
      code: "WASTE_NOTES_TOO_LONG",
      message: errorMessages.WASTE_NOTES_TOO_LONG,
    };
  }

  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    input.expectedVersion > 2147483647
  ) {
    return {
      success: false,
      code: "INVALID_REPORT_VERSION",
      message: errorMessages.INVALID_REPORT_VERSION,
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "save_meal_waste_report",
    {
      p_meal_slot_id: input.mealId,
      p_prepared_portions: prepared,
      p_leftover_portions: leftover,
      p_waste_grams: wasteGrams,
      p_notes: notes,
      p_expected_version: input.expectedVersion,
    }
  );

  if (error) {
    const knownMessage = errorMessages[error.message];

    if (knownMessage) {
      return {
        success: false,
        code: error.message,
        message: knownMessage,
      };
    }

    if (
      error.code === "40P01" ||
      error.code === "40001"
    ) {
      return {
        success: false,
        code: "RETRY_REQUIRED",
        message:
          "Another update was being processed. Please try saving again.",
      };
    }

    console.error(
      "Waste report save failed:",
      error.code
    );

    return {
      success: false,
      message:
        "Could not save the report. Refresh to check its current values before retrying.",
    };
  }

  if (
    !isWasteReport(data) ||
    data.meal_slot_id !== input.mealId
  ) {
    return {
      success: false,
      message:
        "Could not confirm the saved report. Refresh the page to check before retrying.",
    };
  }

  revalidatePath("/admin/analytics");
  revalidatePath("/admin");

  return {
    success: true,
    message: "Waste report saved successfully.",
    report: data,
  };
}