import { Suspense } from "react";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { DashboardLogoutButton } from "@/components/dashboard-logout-button";
import { MealChoiceControls } from "@/components/meal-choice-controls";
import { StudentDietaryPreferences } from "@/components/student-dietary-preferences";

type Meal = {
  id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  cutoff_at: string;
  serve_start: string;
  serve_end: string;
  price_paise: number;
};

type Enrollment = {
  meal_slot_id: string;
  status: "OPTED_IN" | "OPTED_OUT";
};

const mealNames: Record<string, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
};

function formatMealDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T00:00:00+05:30`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatPrice(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);
}

async function StudentDashboard() {
  const { user, profile } = await requireRole("STUDENT");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("meal_slots")
    .select(
      "id, meal_date, meal_type, menu, cutoff_at, serve_start, serve_end, price_paise",
    )
    .gt("serve_end", new Date().toISOString())
    .order("serve_start", { ascending: true })
    .limit(21);

  const meals: Meal[] = data ?? [];

  let enrollments: Enrollment[] = [];
  let choicesFailed = false;

  if (!error && meals.length > 0) {
    const result = await supabase
      .from("meal_enrollments")
      .select("meal_slot_id, status")
      .eq("student_id", user.id)
      .in(
        "meal_slot_id",
        meals.map((meal) => meal.id),
      );

    choicesFailed = Boolean(result.error);
    enrollments = result.data ?? [];
  }

  const choiceByMeal = new Map(
    enrollments.map((entry) => [
      entry.meal_slot_id,
      entry.status,
    ]),
  );

 // eslint-disable-next-line react-hooks/purity -- Supply a request-time server clock snapshot to the meal countdown.
const serverNow = Date.now();

  return (
    <main className="min-h-screen bg-[#F5F8F7] px-4 py-6 text-[#152D33] sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex justify-end">
          <DashboardLogoutButton />
        </div>

        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#087A68]">
            Kamar-Taj Refectory
          </p>

          <h1 className="mt-3 break-words text-3xl font-bold tracking-tight sm:text-4xl">
            Welcome, {profile.full_name || "Student"}
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
            Plan your meals and update your choices before
            the deadline.
          </p>
        </header>

        <section
          aria-labelledby="student-account-heading"
          className="rounded-2xl border border-[#DCE7E2] bg-white p-5 shadow-sm sm:p-6"
        >
          <h2
            id="student-account-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Your account
          </h2>

          <dl className="mt-5 grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-500">
                Email
              </dt>

              <dd className="mt-1 break-all text-sm font-medium">
                {user.email}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-slate-500">
                Role
              </dt>

              <dd className="mt-1 text-sm font-medium">
                {profile.role}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-slate-500">
                Account status
              </dt>

              <dd className="mt-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#E8F6EE] px-3 py-1 text-xs font-semibold text-[#08634C]">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-[#087A68]"
                  />
                  {profile.account_status}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <StudentDietaryPreferences />

        <section aria-labelledby="upcoming-meals-heading">
          <div className="mb-5">
            <h2
              id="upcoming-meals-heading"
              className="text-2xl font-bold tracking-tight"
            >
              Upcoming meals
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Showing up to 21 meals whose serving time
              has not ended. All times are in IST.
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
            >
              Could not load meals. Please refresh the page.
            </p>
          ) : meals.length === 0 ? (
            <div className="rounded-2xl border border-[#DCE7E2] bg-white p-8 text-center">
              <h3 className="text-lg font-semibold">
                No upcoming meals yet
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                Meals will appear here after the kitchen
                publishes them.
              </p>
            </div>
          ) : (
            <>
              {choicesFailed && (
                <p
                  role="alert"
                  className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
                >
                  Could not load your saved choices.
                  Please refresh before making changes.
                </p>
              )}

              <div className="grid gap-5 lg:grid-cols-2">
                {meals.map((meal) => (
                  <article
                    key={meal.id}
                    className="min-w-0 rounded-2xl border border-[#DCE7E2] bg-white p-5 shadow-sm sm:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-slate-500">
                          {formatMealDate(meal.meal_date)}
                        </p>

                        <h3 className="mt-2 text-xl font-bold tracking-tight">
                          {mealNames[meal.meal_type] ||
                            meal.meal_type}
                        </h3>
                      </div>

                      <span className="shrink-0 rounded-full bg-[#E8F6EE] px-3 py-1.5 text-sm font-semibold tabular-nums text-[#08634C]">
                        {formatPrice(meal.price_paise)}
                      </span>
                    </div>

                    <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                      {meal.menu}
                    </p>

                    <dl className="mt-5 grid gap-4 border-t border-[#E6EEE9] pt-5 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-slate-500">
                          Serving starts
                        </dt>

                        <dd className="mt-1 font-medium">
                          {formatDateTime(meal.serve_start)}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-xs text-slate-500">
                          Serving ends
                        </dt>

                        <dd className="mt-1 font-medium">
                          {formatDateTime(meal.serve_end)}
                        </dd>
                      </div>

                      <div className="rounded-xl bg-[#F1F7F3] p-3 sm:col-span-2">
                        <dt className="text-xs text-[#526D64]">
                          Meal-choice deadline
                        </dt>

                        <dd className="mt-1 font-semibold text-[#103C39]">
                          {formatDateTime(meal.cutoff_at)}
                        </dd>
                      </div>
                    </dl>

                    {!choicesFailed && (
                      <MealChoiceControls
                        mealId={meal.id}
                        status={
                          choiceByMeal.get(meal.id) ?? null
                        }
                        cutoffAt={meal.cutoff_at}
                        serverNow={serverNow}
                      />
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default function StudentPage() {
  return (
    <Suspense
      fallback={
        <p
          role="status"
          className="p-8 text-sm text-[#526D64]"
        >
          Loading your dashboard…
        </p>
      }
    >
      <StudentDashboard />
    </Suspense>
  );
}