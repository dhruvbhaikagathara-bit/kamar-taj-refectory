import { Suspense } from "react";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { StudentDietaryPreferences } from "@/components/student-dietary-preferences";

import { MealPlanner } from "./meal-planner";
import {
  WeeklyMeals,
  type WeeklyEnrollment,
  type WeeklyMeal,
} from "./weekly-meals";
import type { PlanHistory } from "./types";

function getTodayIST(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function PlannerContent() {
  const { user } = await requireRole("STUDENT");
  const supabase = await createClient();

  // One server-time snapshot for the date range and controls.
  // eslint-disable-next-line react-hooks/purity -- Read the server clock after authentication.
  const serverNow = Date.now();

  const today = getTodayIST(new Date(serverNow));
  const lastDay = addDays(today, 6);

  const [plansResult, mealsResult] = await Promise.all([
    supabase.rpc("get_my_meal_plans"),

    supabase
      .from("meal_slots")
      .select(
        "id, meal_date, meal_type, menu, cutoff_at, serve_start, serve_end"
      )
      .gte("meal_date", today)
      .lte("meal_date", lastDay)
      .order("serve_start", { ascending: true }),
  ]);

  const meals: WeeklyMeal[] =
    (mealsResult.data ?? []) as WeeklyMeal[];

  let enrollments: WeeklyEnrollment[] = [];
  let choicesFailed = false;

  if (!mealsResult.error && meals.length > 0) {
    const enrollmentResult = await supabase
      .from("meal_enrollments")
      .select("meal_slot_id, status")
      .eq("student_id", user.id)
      .in(
        "meal_slot_id",
        meals.map((meal) => meal.id)
      );

    choicesFailed = Boolean(enrollmentResult.error);

    if (!enrollmentResult.error) {
      enrollments =
        (enrollmentResult.data ?? []) as WeeklyEnrollment[];
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <WeeklyMeals
        today={today}
        meals={meals}
        enrollments={enrollments}
        serverNow={serverNow}
        mealsFailed={Boolean(mealsResult.error)}
        choicesFailed={choicesFailed}
      />

      <div className="mb-8">
        <StudentDietaryPreferences />
      </div>

      <section aria-labelledby="range-planner-heading">
        <header className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#087A68]">
            Date-range planner
          </p>

          <h2
            id="range-planner-heading"
            className="mt-2 text-2xl font-bold text-[#152D33]"
          >
            Plan for a longer period
          </h2>

          <p className="mt-3 text-sm leading-6 text-slate-600">
            Going home or returning early? Set your choices
            for a date range, including meals that have not
            been published yet.
          </p>
        </header>

        {plansResult.error ? (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-5 text-red-800"
          >
            Unable to load your date-range plans. Check that
            the database migration has been applied, then
            refresh.
          </p>
        ) : (
          <MealPlanner
            today={today}
            history={(plansResult.data ?? []) as PlanHistory[]}
          />
        )}
      </section>
    </main>
  );
}

export default function MealPlannerPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8">
          Loading Meal Planner…
        </p>
      }
    >
      <PlannerContent />
    </Suspense>
  );
}