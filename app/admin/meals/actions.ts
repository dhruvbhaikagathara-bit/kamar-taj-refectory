"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export type CreateMealState = {
  success: boolean;
  message: string;
};

const IST_OFFSET_MS = 330 * 60 * 1000;

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function getISTDate(milliseconds: number): string {
  return new Date(milliseconds + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

// Form date/time values are interpreted as IST,
// regardless of the server's configured timezone.
function parseIST(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}:00+05:30`);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  // Reject dates that JavaScript would otherwise normalize.
  const roundTrip = new Date(
    date.getTime() + IST_OFFSET_MS
  )
    .toISOString()
    .slice(0, 16);

  return roundTrip === value ? date : null;
}

function validateFutureSchedule(
  mealDate: string,
  cutoff: Date,
  start: Date,
  now: number
): string | null {
  if (mealDate < getISTDate(now)) {
    return "You cannot create a meal for a date before today in IST.";
  }

  if (start.getTime() <= now) {
    return "Serving must start after the current time in IST.";
  }

  if (cutoff.getTime() <= now) {
    return "The meal-choice cutoff must be after the current time in IST.";
  }

  return null;
}

export async function createMeal(
  _previousState: CreateMealState,
  formData: FormData
): Promise<CreateMealState> {
  await requireRole("ADMIN");

  const mealDate = readText(formData, "meal_date");
  const mealType = readText(formData, "meal_type");
  const menu = readText(formData, "menu");
  const priceText = readText(formData, "price_rupees");

  const cutoffText = readText(formData, "cutoff_at");
  const startText = readText(formData, "serve_start");
  const endText = readText(formData, "serve_end");

  if (!parseIST(`${mealDate}T00:00`)) {
    return {
      success: false,
      message: "Choose a valid meal date.",
    };
  }

  if (mealDate < getISTDate(Date.now())) {
    return {
      success: false,
      message:
        "You cannot create a meal for a date before today in IST.",
    };
  }

  if (!["BREAKFAST", "LUNCH", "DINNER"].includes(mealType)) {
    return {
      success: false,
      message: "Choose a valid meal type.",
    };
  }

  if (menu.length < 3 || menu.length > 1000) {
    return {
      success: false,
      message: "Enter a menu between 3 and 1,000 characters.",
    };
  }

  if (!/^\d{1,5}(\.\d{1,2})?$/.test(priceText)) {
    return {
      success: false,
      message:
        "Enter a valid price with at most two decimal places.",
    };
  }

  // Store whole paise without floating-point multiplication.
  const [rupees, fraction = ""] = priceText.split(".");
  const pricePaise =
    Number(rupees) * 100 +
    Number(fraction.padEnd(2, "0"));

  if (pricePaise > 1000000) {
    return {
      success: false,
      message:
        "The meal price must be between ₹0 and ₹10,000.",
    };
  }

  const cutoff = parseIST(cutoffText);
  const start = parseIST(startText);
  const end = parseIST(endText);

  if (!cutoff || !start || !end) {
    return {
      success: false,
      message:
        "Enter valid cutoff and serving dates and times in IST.",
    };
  }

  if (startText.slice(0, 10) !== mealDate) {
    return {
      success: false,
      message:
        "Serving must start on the selected meal date.",
    };
  }

  if (cutoff.getTime() > start.getTime()) {
    return {
      success: false,
      message:
        "The cutoff cannot be after serving starts.",
    };
  }

  if (end.getTime() <= start.getTime()) {
    return {
      success: false,
      message: "Serving must end after it starts.",
    };
  }

  const scheduleError = validateFutureSchedule(
    mealDate,
    cutoff,
    start,
    Date.now()
  );

  if (scheduleError) {
    return {
      success: false,
      message: scheduleError,
    };
  }

  const supabase = await createClient();

  // Recheck immediately before sending the insert.
  // The form may have been open for a long time.
  const latestScheduleError = validateFutureSchedule(
    mealDate,
    cutoff,
    start,
    Date.now()
  );

  if (latestScheduleError) {
    return {
      success: false,
      message: latestScheduleError,
    };
  }

  const { data, error } = await supabase
    .from("meal_slots")
    .insert({
      meal_date: mealDate,
      meal_type: mealType,
      menu,
      cutoff_at: cutoff.toISOString(),
      serve_start: start.toISOString(),
      serve_end: end.toISOString(),
      price_paise: pricePaise,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        message:
          "That meal type already exists for this date.",
      };
    }

    console.error(
      "Meal creation failed:",
      error.code,
      error.message
    );

    return {
      success: false,
      message: "Could not create the meal. Please try again.",
    };
  }

  if (!data) {
    return {
      success: false,
      message:
        "Meal creation could not be confirmed. Refresh before retrying.",
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/meals");
  revalidatePath("/admin/analytics");
  revalidatePath("/student");

  return {
    success: true,
    message: "Meal created successfully.",
  };
}