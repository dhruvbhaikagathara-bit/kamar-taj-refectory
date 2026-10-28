export type MealType =
  | "BREAKFAST"
  | "LUNCH"
  | "DINNER";

export type MealStatus =
  | "OPTED_IN"
  | "OPTED_OUT";

export type PlanInput = {
  startDate: string;
  endDate: string;
  status: MealStatus;
  mealTypes: MealType[];
};

export type PlanPreview = {
  request_id: string;
  published: number;
  locked: number;
  unchanged: number;
  updates: number;
  unpublished: number;
  overlap_slots: number;
  new_charges_paise: number;
  credits_paise: number;
  reversals_paise: number;
};

export type PlanResult = {
  plan_id: string;
  updated: number;
  unchanged: number;
  locked: number;
  unpublished: number;
  replayed?: boolean;
};

export type PlanHistory = {
  id: string;
  sequence_no: number;
  start_date: string;
  end_date: string;
  desired_status: MealStatus;
  meal_types: MealType[];
  created_at: string;
  stopped_at: string | null;
  initial_result: PlanResult;
  scheduled_slots: number;
  future_updated: number;
  future_locked: number;
};

export type ActionResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      message: string;
    };