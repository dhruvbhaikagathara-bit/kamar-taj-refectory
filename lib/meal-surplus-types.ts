export const SURPLUS_STATUSES = [
  "AVAILABLE",
  "ASSIGNED",
  "COLLECTED",
  "DISCARDED",
  "CANCELLED",
] as const;

export type MealSurplusStatus =
  (typeof SURPLUS_STATUSES)[number];

export type MealSurplusReport = {
  meal_slot_id: string;
  portions: number;
  collect_by: string;
  status: MealSurplusStatus;
  recipient: string;
  notes: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type MealSurplusHistory = {
  meal_slot_id: string;
  version: number;
  actor_id: string;
  recorded_at: string;
  snapshot: MealSurplusReport;
};

export type MealSurplusActionState = {
  success: boolean;
  message: string;
};

export const SURPLUS_STATUS_LABELS: Record<
  MealSurplusStatus,
  string
> = {
  AVAILABLE: "Available",
  ASSIGNED: "Assigned",
  COLLECTED: "Collected",
  DISCARDED: "Discarded",
  CANCELLED: "Cancelled",
};

export function isMealSurplusStatus(
  value: unknown
): value is MealSurplusStatus {
  return (
    typeof value === "string" &&
    SURPLUS_STATUSES.some((status) => status === value)
  );
}

export function isSurplusClosed(
  status: MealSurplusStatus
): boolean {
  return (
    status === "COLLECTED" ||
    status === "DISCARDED" ||
    status === "CANCELLED"
  );
}

// Pass the current time explicitly to keep rendering consistent.
// Expiry is a display condition, not another stored status.
export function isSurplusExpired(
  report: MealSurplusReport,
  nowMilliseconds: number
): boolean {
  if (isSurplusClosed(report.status)) return false;

  const deadline = Date.parse(report.collect_by);

  return (
    !Number.isFinite(deadline) ||
    nowMilliseconds >= deadline
  );
}

export function isSurplusAvailable(
  report: MealSurplusReport,
  nowMilliseconds: number
): boolean {
  return (
    report.status === "AVAILABLE" &&
    report.portions > 0 &&
    !isSurplusExpired(report, nowMilliseconds)
  );
}