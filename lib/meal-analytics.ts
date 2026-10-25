import "server-only";

export type MealAnalytics = {
  id: string;
  meal_type: string;
  menu: string;
  cutoff_at: string;
  serve_start: string;
  serve_end: string;
  expected_count: number;
  collected_count: number;
  opted_out_count: number;
  vegetarian_count: number;
  nonvegetarian_count: number;
  vegan_count: number;
  jain_count: number;
  unspecified_count: number;
};

export function getIndiaDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const value = (type: string) =>
    parts.find((part) => part.type === type)!.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function isAnalyticsDate(value: string): boolean {
  if (!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function formatIndiaTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}