"use client";

import { useState } from "react";
import { MealChoiceControls } from "@/components/meal-choice-controls";

export type WeeklyMeal = {
  id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  cutoff_at: string;
  serve_start: string;
  serve_end: string;
};

export type WeeklyEnrollment = {
  meal_slot_id: string;
  status: "OPTED_IN" | "OPTED_OUT";
};

type WeeklyMealsProps = {
  today: string;
  meals: WeeklyMeal[];
  enrollments: WeeklyEnrollment[];
  serverNow: number;
  mealsFailed: boolean;
  choicesFailed: boolean;
};

const mealNames: Record<string, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
};

const mealIcons: Record<string, string> = {
  BREAKFAST: "🥗",
  LUNCH: "🍛",
  DINNER: "🍲",
};

// Date-only values are handled in UTC so the browser's
// timezone does not move the selected calendar date.
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateObject(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    timeZone: "UTC",
  }).format(dateObject(date));
}

function formatDayNumber(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    timeZone: "UTC",
  }).format(dateObject(date));
}

function formatFullDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateObject(date));
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateObject(date));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatDeadline(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function WeeklyMeals({
  today,
  meals,
  enrollments,
  serverNow,
  mealsFailed,
  choicesFailed,
}: WeeklyMealsProps) {
  const [selectedDate, setSelectedDate] = useState(today);

  // Show today and the next six days.
  const days = Array.from(
    { length: 7 },
    (_, index) => addDays(today, index)
  );

  const selectedMeals = meals.filter(
    (meal) => meal.meal_date === selectedDate
  );

  const choiceByMeal = new Map(
    enrollments.map((entry) => [
      entry.meal_slot_id,
      entry.status,
    ])
  );

  return (
    <section
      aria-labelledby="weekly-meals-heading"
      className="mb-8 space-y-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="weekly-meals-heading"
            className="text-2xl font-bold tracking-tight text-[#152D33] sm:text-3xl"
          >
            Plan your week.
          </h2>

          <p className="mt-2 text-sm text-slate-600">
            Choose a day and manage each published meal
            before its cutoff. All times are in IST.
          </p>
        </div>

        <span className="rounded-full bg-[#EFF5F7] px-3 py-1.5 text-xs font-semibold text-slate-600">
          {formatShortDate(days[0])}
          {" – "}
          {formatShortDate(days[6])}
        </span>
      </div>

      <div
        role="group"
        aria-label="Select a meal date"
        className="grid grid-cols-4 gap-2 sm:grid-cols-7"
      >
        {days.map((day) => {
          const selected = day === selectedDate;

          return (
            <button
              key={day}
              type="button"
              aria-pressed={selected}
              onClick={() => setSelectedDate(day)}
              className={[
                "min-h-16 rounded-xl border px-2 py-3 text-center",
                "transition-colors focus-visible:outline-none",
                "focus-visible:ring-2 focus-visible:ring-emerald-500",
                "focus-visible:ring-offset-2",
                selected
                  ? "border-[#087A68] bg-[#087A68] text-white"
                  : "border-[#E1EAE6] bg-white text-[#152D33] hover:bg-emerald-50",
              ].join(" ")}
            >
              <span
                className={[
                  "block text-[10px] font-semibold uppercase",
                  selected ? "text-emerald-100" : "text-slate-500",
                ].join(" ")}
              >
                {formatWeekday(day)}
              </span>

              <span className="mt-1 block text-base font-bold">
                {formatDayNumber(day)}
              </span>

              {day === today && (
                <span
                  className={[
                    "mt-1 block text-[10px]",
                    selected
                      ? "text-emerald-100"
                      : "text-slate-500",
                  ].join(" ")}
                >
                  Today
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[#E1EAE6] bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold text-[#152D33]">
            {formatFullDate(selectedDate)}
          </h3>

          <span className="rounded-full bg-[#E3F5EB] px-3 py-1 text-xs font-semibold text-[#08634C]">
            Published meals
          </span>
        </div>

        {mealsFailed ? (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
          >
            Could not load weekly meals. Refresh the page
            to try again.
          </p>
        ) : selectedMeals.length === 0 ? (
          <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
            No meals have been published for this day yet.
            Your date-range plans below can still apply to
            future meals.
          </p>
        ) : (
          <>
            {choicesFailed && (
              <p
                role="alert"
                className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800"
              >
                Could not load your meal choices. Refresh
                before making changes.
              </p>
            )}

            <div className="mt-5 space-y-3">
              {selectedMeals.map((meal) => {
                const choice = choiceByMeal.get(meal.id);

                const locked =
                  serverNow >= Date.parse(meal.cutoff_at);

                const choiceLabel = choicesFailed
                  ? "Unavailable"
                  : choice === "OPTED_IN"
                    ? "Opted in"
                    : choice === "OPTED_OUT"
                      ? "Opted out"
                      : "No saved choice";

                const choiceClass =
                  !choicesFailed && choice === "OPTED_IN"
                    ? "bg-[#E3F5EB] text-[#08634C]"
                    : !choicesFailed && choice === "OPTED_OUT"
                      ? "bg-orange-50 text-orange-800"
                      : "bg-slate-100 text-slate-700";

                return (
                  <details
                    key={meal.id}
                    className="group rounded-xl border border-[#E5ECE8] bg-white"
                  >
                    <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] [&::-webkit-details-marker]:hidden">
                      <span
                        aria-hidden="true"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF0E6] text-xl"
                      >
                        {mealIcons[meal.meal_type] ?? "🍽️"}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[#152D33]">
                            {mealNames[meal.meal_type] ??
                              meal.meal_type}
                          </span>

                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${choiceClass}`}
                          >
                            {choiceLabel}
                          </span>
                        </span>

                        <span className="mt-1 block break-words text-xs leading-5 text-slate-600">
                          {meal.menu}
                        </span>

                        <span className="mt-1 block text-xs text-slate-500">
                          {formatTime(meal.serve_start)}
                          {" – "}
                          {formatTime(meal.serve_end)} IST
                        </span>

                        <span className="mt-1 block text-xs text-slate-500">
                          Cutoff: {formatDeadline(meal.cutoff_at)} IST
                        </span>
                      </span>

                      <span className="shrink-0 rounded-lg border border-[#E1EAE6] px-3 py-2 text-xs font-semibold text-[#103C39]">
                        {locked ? "Locked" : "Manage"}
                      </span>
                    </summary>

                    <div className="border-t border-[#E8EEEB] px-4 pb-4 pt-2 sm:ml-14">
                      {choicesFailed ? (
                        <p className="py-3 text-sm text-slate-600">
                          Choices are unavailable until the
                          page reloads successfully.
                        </p>
                      ) : (
                        <MealChoiceControls
                          mealId={meal.id}
                          status={choice ?? null}
                          cutoffAt={meal.cutoff_at}
                          serverNow={serverNow}
                        />
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}