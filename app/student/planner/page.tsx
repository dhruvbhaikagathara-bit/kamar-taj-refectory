import { Suspense } from "react";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { MealPlanner } from "./meal-planner";
import type { PlanHistory } from "./types";

async function PlannerContent() {
  await requireRole("STUDENT");

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_my_meal_plans"
  );

  // Calculate today's date in IST after authentication.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-[#087A68]">
          Meal Planner
        </p>

        <h1 className="mt-2 text-3xl font-bold">
          Plan your meals
        </h1>

        <p className="mt-3 text-slate-600">
          Going home or returning early? Set your choices
          for a date range, including meals that have not
          been published yet.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-5 text-red-800"
        >
          Unable to load Meal Planner. Check that the
          database migration has been applied, then refresh.
        </p>
      ) : (
        <MealPlanner
          today={today}
          history={(data ?? []) as PlanHistory[]}
        />
      )}
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