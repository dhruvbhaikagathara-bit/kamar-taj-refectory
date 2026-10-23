"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export type DietaryState = {
  success: boolean;
  message: string;
};

export async function saveDietaryPreference(
  _previousState: DietaryState,
  formData: FormData
): Promise<DietaryState> {
  await requireRole("STUDENT");

  const preference = formData.get("preference");
  const rawNotes = formData.get("notes");

  const allowedPreferences = [
    "VEGETARIAN",
    "NON_VEGETARIAN",
    "VEGAN",
    "JAIN",
  ];

  if (
    typeof preference !== "string" ||
    !allowedPreferences.includes(preference)
  ) {
    return {
      success: false,
      message: "Please choose a dietary preference.",
    };
  }

  const notes = typeof rawNotes === "string" ? rawNotes.trim() : "";

  if (notes.length > 500) {
    return {
      success: false,
      message: "Keep food notes within 500 characters.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "set_my_dietary_preference",
    {
      p_preference: preference,
      p_notes: notes,
    }
  );

  if (error) {
    const messages: Record<string, string> = {
      AUTH_REQUIRED: "Please log in again.",
      ACTIVE_STUDENT_REQUIRED: "An active student account is required.",
      INVALID_DIETARY_PREFERENCE: "Choose a valid dietary preference.",
      DIETARY_NOTES_TOO_LONG: "Keep food notes within 500 characters.",
    };

    return {
      success: false,
      message:
        messages[error.message] ??
        "Could not save your preference. Please try again.",
    };
  }

  if (data !== preference) {
    return {
      success: false,
      message: "Could not confirm the save. Please refresh the page.",
    };
  }

  revalidatePath("/student");

  return {
    success: true,
    message: "Your dietary preference has been saved.",
  };
}