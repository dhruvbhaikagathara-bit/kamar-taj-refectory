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
      "id, meal_date, meal_type, menu, cutoff_at, serve_start, serve_end, price_paise"
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
        meals.map((meal) => meal.id)
      );

    choicesFailed = Boolean(result.error);
    enrollments = result.data ?? [];
  }

  const choiceByMeal = new Map(
    enrollments.map((entry) => [entry.meal_slot_id, entry.status])
  );

  const serverNow = Date.now();

  return (
    <main className="min-h-screen bg-[#FAFCFC] px-6 py-12 text-[#152D33]">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex justify-end">
          <DashboardLogoutButton />
        </div>

        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#087A68]">
            Kamar-Taj Refectory
          </p>

          <h1 className="mt-3 text-3xl font-bold">
            Welcome, {profile.full_name || "Student"}
          </h1>

          <p className="mt-2 text-slate-600">
            Plan your meals and update your choices before the deadline.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Your account</h2>

          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-slate-500">Email</dt>
              <dd className="break-all font-medium">{user.email}</dd>
            </div>

            <div>
              <dt className="text-sm text-slate-500">Role</dt>
              <dd className="font-medium">{profile.role}</dd>
            </div>

            <div>
              <dt className="text-sm text-slate-500">Account status</dt>
              <dd className="font-medium text-[#087A68]">
                {profile.account_status}
              </dd>
            </div>
          </dl>
        </section>

        <StudentDietaryPreferences />

        <section aria-labelledby="upcoming-meals-heading">
          <div className="mb-5">
            <h2
              id="upcoming-meals-heading"
              className="text-2xl font-bold"
            >
              Upcoming meals
            </h2>

            <p className="mt-1 text-sm text-slate-600">
              Showing up to 21 meals whose serving time has not ended.
              All times are in IST.
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-2xl bg-red-50 p-6 text-red-800"
            >
              Could not load meals. Please refresh the page.
            </p>
          ) : meals.length === 0 ? (
            <div className="rounded-2xl bg-[#EFF5F7] p-8 text-center">
              <h3 className="text-lg font-semibold">
                No upcoming meals yet
              </h3>

              <p className="mt-2 text-slate-600">
                Meals will appear here after the kitchen publishes them.
              </p>
            </div>
          ) : (
            <>
              {choicesFailed && (
                <p
                  role="alert"
                  className="mb-5 rounded-xl bg-red-50 p-4 text-red-800"
                >
                  Could not load your saved choices. Please refresh
                  before making changes.
                </p>
              )}

              <div className="grid gap-5 md:grid-cols-2">
                {meals.map((meal) => (
                  <article
                    key={meal.id}
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-slate-500">
                          {formatMealDate(meal.meal_date)}
                        </p>

                        <h3 className="mt-1 text-xl font-bold">
                          {mealNames[meal.meal_type] || meal.meal_type}
                        </h3>
                      </div>

                      <span className="shrink-0 rounded-full bg-[#EFF5F7] px-3 py-1.5 font-semibold text-[#087A68]">
                        {formatPrice(meal.price_paise)}
                      </span>
                    </div>

                    <p className="mt-4 whitespace-pre-wrap break-words text-slate-700">
                      {meal.menu}
                    </p>

                    <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
                      <div>
                        <dt className="text-slate-500">
                          Serving starts
                        </dt>
                        <dd className="font-medium">
                          {formatDateTime(meal.serve_start)}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-slate-500">
                          Serving ends
                        </dt>
                        <dd className="font-medium">
                          {formatDateTime(meal.serve_end)}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-slate-500">
                          Meal-choice deadline
                        </dt>
                        <dd className="font-semibold text-[#103C39]">
                          {formatDateTime(meal.cutoff_at)}
                        </dd>
                      </div>
                    </dl>

                    {!choicesFailed && (
                      <MealChoiceControls
                        mealId={meal.id}
                        status={choiceByMeal.get(meal.id) ?? null}
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
    <Suspense fallback={<p className="p-8">Loading your dashboard...</p>}>
      <StudentDashboard />
    </Suspense>
  );
}