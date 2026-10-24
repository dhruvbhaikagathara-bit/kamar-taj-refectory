"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export type UpdateMenuState = {
  success: boolean;
  message: string;
};

export async function updateMealMenu(
  _previousState: UpdateMenuState,
  formData: FormData
): Promise<UpdateMenuState> {
  // Check authorization on every submission.
  await requireRole("ADMIN");

  const rawMealId = formData.get("meal_slot_id");
  const rawMenu = formData.get("menu");

  if (
    typeof rawMealId !== "string" ||
    typeof rawMenu !== "string"
  ) {
    return {
      success: false,
      message: "Select a meal and enter its updated menu.",
    };
  }

  const mealId = rawMealId.trim().toLowerCase();
  const menu = rawMenu.trim();

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  if (!uuidPattern.test(mealId)) {
    return {
      success: false,
      message: "Please select a valid meal.",
    };
  }

  const menuLength = Array.from(menu).length;

  if (menuLength < 3 || menuLength > 1000) {
    return {
      success: false,
      message: "The menu must contain between 3 and 1,000 characters.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "admin_update_meal_menu",
    {
      p_meal_slot_id: mealId,
      p_menu: menu,
    }
  );

  if (error) {
    switch (error.message) {
      case "MEAL_CUTOFF_PASSED":
        return {
          success: false,
          message:
            "This meal's cutoff has passed. Its menu can no longer be edited.",
        };

      case "MEAL_NOT_FOUND":
        return {
          success: false,
          message: "This meal was not found. Refresh the page.",
        };

      case "INVALID_MENU_LENGTH":
        return {
          success: false,
          message:
            "The menu must contain between 3 and 1,000 characters.",
        };

      case "AUTH_REQUIRED":
      case "ACTIVE_ADMIN_REQUIRED":
        return {
          success: false,
          message: "An active admin account is required.",
        };

      default:
        console.error("Menu update error:", {
          code: error.code,
          message: error.message,
        });

        return {
          success: false,
          message:
            "We could not confirm the update. Refresh and check the menu before trying again.",
        };
    }
  }

  if (data !== mealId) {
    return {
      success: false,
      message:
        "We could not confirm the update. Refresh and check the menu before trying again.",
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/meals");
  revalidatePath("/admin/meals/edit");
  revalidatePath("/student");

  return {
    success: true,
    message: "Menu updated successfully.",
  };
}