"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export type MealChoiceState = {
  success: boolean;
  message: string;
};

export async function changeMealChoice(
  mealId: string,
  _previousState: MealChoiceState,
  formData: FormData
): Promise<MealChoiceState> {
  await requireRole("STUDENT");

  const status = formData.get("status");

  if (status !== "OPTED_IN" && status !== "OPTED_OUT") {
    return { success: false, message: "Choose a valid meal option." };
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      mealId
    )
  ) {
    return { success: false, message: "Invalid meal." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_my_meal_choice", {
    p_meal_slot_id: mealId,
    p_status: status,
  });

  if (error) {
    const messages: Record<string, string> = {
      AUTH_REQUIRED: "Please log in again.",
      ACTIVE_STUDENT_REQUIRED: "An active student account is required.",
      INVALID_MEAL_STATUS: "Choose a valid meal option.",
      MEAL_NOT_FOUND: "This meal could not be found.",
      MEAL_CUTOFF_PASSED: "The deadline has passed. Your choice was not changed.",
      MEAL_ALREADY_REDEEMED: "This meal has already been collected.",
    };

    return {
      success: false,
      message:
        messages[error.message] ??
        "Could not save your choice. Please refresh and try again.",
    };
  }

  if (data !== status) {
    return {
      success: false,
      message: "Could not confirm your choice. Please refresh the page.",
    };
  }

  revalidatePath("/student");
  revalidatePath("/admin");

  return {
    success: true,
    message:
      status === "OPTED_IN"
        ? "Saved: you will eat this meal."
        : "Saved: you will skip this meal.",
  };
}