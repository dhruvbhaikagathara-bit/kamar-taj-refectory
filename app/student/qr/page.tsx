import { Suspense } from "react";
import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { StudentMealPass } from "@/components/student-meal-pass";

type PageProps = {
  searchParams: Promise<{
    mealId?: string | string[];
  }>;
};

type Meal = {
  id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  serve_start: string;
  serve_end: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T00:00:00+05:30`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

async function MealPassContent({ searchParams }: PageProps) {
  const { user } = await requireRole("STUDENT");
  const params = await searchParams;
  const supabase = await createClient();

  const { data, error: mealsError } = await supabase
    .from("meal_slots")
    .select(
      "id, meal_date, meal_type, menu, serve_start, serve_end"
    )
    .gt("serve_end", new Date().toISOString())
    .order("serve_start", { ascending: true })
    .limit(60);

  const meals = (data ?? []) as Meal[];
  const enrolledIds = new Set<string>();
  let loadFailed = Boolean(mealsError);

  if (!mealsError && meals.length > 0) {
    const { data: enrollments, error: enrollmentError } =
      await supabase
        .from("meal_enrollments")
        .select("meal_slot_id")
        .eq("student_id", user.id)
        .eq("status", "OPTED_IN")
        .in(
          "meal_slot_id",
          meals.map((meal) => meal.id)
        );

    if (enrollmentError) {
      loadFailed = true;
    } else {
      for (const enrollment of enrollments ?? []) {
        enrolledIds.add(enrollment.meal_slot_id);
      }
    }
  }

  const eligibleMeals = meals.filter((meal) =>
    enrolledIds.has(meal.id)
  );

  const selectedMeal =
    typeof params.mealId === "string"
      ? eligibleMeals.find((meal) => meal.id === params.mealId)
      : eligibleMeals[0];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/student"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-[#087A68] hover:underline"
      >
        ← Back to my meals
      </Link>

      <header className="mb-6 mt-4">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#087A68]">
          Student portal
        </p>

        <h1 className="mt-2 text-3xl font-bold text-[#152D33]">
          Meal QR pass
        </h1>

        <p className="mt-3 text-slate-600">
          Select a meal you have opted in to. Your QR becomes
          available during its serving window.
        </p>
      </header>

      {loadFailed ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800"
        >
          Unable to load your meals. Refresh the page and try again.
        </div>
      ) : eligibleMeals.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-[#152D33]">
            No upcoming enrolled meals
          </h2>

          <p className="mt-2 text-slate-600">
            Open My meals and opt in before the cutoff to receive
            a meal pass.
          </p>
        </div>
      ) : (
        <>
          <form
            action="/student/qr"
            method="get"
            className="mb-6 rounded-2xl border border-slate-200 bg-white p-6"
          >
            <label
              htmlFor="qr-meal"
              className="block text-sm font-semibold text-[#152D33]"
            >
              Choose your meal
            </label>

            <select
              key={selectedMeal?.id ?? "none"}
              id="qr-meal"
              name="mealId"
              required
              defaultValue={selectedMeal?.id ?? ""}
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[#152D33] focus:outline-none focus:ring-2 focus:ring-[#087A68]"
            >
              <option value="" disabled>
                Select a meal
              </option>

              {eligibleMeals.map((meal) => (
                <option key={meal.id} value={meal.id}>
                  {formatDate(meal.meal_date)} · {meal.meal_type}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="mt-4 min-h-11 rounded-xl bg-[#087A68] px-5 py-3 font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2"
            >
              Open meal pass
            </button>
          </form>

          {selectedMeal ? (
            <>
              <div className="mb-6 rounded-2xl bg-[#EFF5F7] p-5">
                <h2 className="font-bold text-[#152D33]">
                  {formatDate(selectedMeal.meal_date)} ·{" "}
                  {selectedMeal.meal_type}
                </h2>

                <p className="mt-2 text-slate-700">
                  {selectedMeal.menu}
                </p>

                <p className="mt-2 text-sm text-slate-600">
                  Serving: {formatTime(selectedMeal.serve_start)}
                  {" – "}
                  {formatTime(selectedMeal.serve_end)} IST
                </p>
              </div>

              <StudentMealPass
                key={selectedMeal.id}
                mealId={selectedMeal.id}
              />
            </>
          ) : (
            <p role="status" className="text-slate-600">
              That meal is unavailable. Choose a meal from the list.
            </p>
          )}
        </>
      )}
    </main>
  );
}

export default function StudentQrPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600" role="status">
          Loading your meal passes…
        </div>
      }
    >
      <MealPassContent {...props} />
    </Suspense>
  );
}