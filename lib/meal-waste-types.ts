export type MealWasteReport = {
  meal_slot_id: string;
  prepared_portions: number;
  leftover_portions: number;
  waste_grams: number;
  notes: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type MealWasteHistory = {
  id: string;
  meal_slot_id: string;
  version: number;
  actor_id: string;
  previous_report: MealWasteReport | null;
  new_report: MealWasteReport;
  recorded_at: string;
};

export type MealWasteInput = {
  mealId: string;
  preparedPortions: string;
  leftoverPortions: string;
  wasteKg: string;
  notes: string;
  expectedVersion: number;
};

export type MealWasteSaveResult =
  | {
      success: true;
      message: string;
      report: MealWasteReport;
    }
  | {
      success: false;
      message: string;
      code?: string;
    };

export type MealWasteSummary = {
  totalMeals: number;
  reportedMeals: number;
  unreportedMeals: number;

  // Totals include only meals with a saved report.
  preparedPortions: number;
  leftoverPortions: number;
  wasteGrams: number;

  // Leftover portions / prepared portions × 100.
  // This is not a discarded-food percentage.
  leftoverPercentage: number | null;
};