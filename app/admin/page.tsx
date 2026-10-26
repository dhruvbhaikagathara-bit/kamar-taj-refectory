import { Suspense } from "react";
import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { DashboardLogoutButton } from "@/components/dashboard-logout-button";

type MealForecast = {
  meal_slot_id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  cutoff_at: string;
  serve_start: string;
  serve_end: string;
  price_paise: number;
  opted_in: number;
  opted_out: number;
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

async function AdminDashboard() {
  const { user, profile } = await requireRole("ADMIN");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_meal_forecast",
  );

  const meals: MealForecast[] = data ?? [];
  const now = Date.now();

  return (
    <main className="min-h-screen bg-[#FAFCFC] px-6 py-12 text-[#152D33]">
      <div className="mx-auto max-w-5xl space-y-8">
        <nav
          aria-label="Admin actions"
          className="flex flex-wrap items-center justify-end gap-3"
        >
          <Link
            href="/admin/meals"
            className="rounded-lg bg-[#087A68] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#103C39]"
          >
            Create meal
          </Link>

          <DashboardLogoutButton />
        </nav>

        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#087A68]">
            Kamar-Taj Refectory
          </p>

          <h1 className="mt-3 text-3xl font-bold">
            Welcome, {profile.full_name || "Admin"}
          </h1>

          <p className="mt-2 text-slate-600">
            Plan kitchen preparation using students’ saved
            meal choices.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">
            Your account
          </h2>

          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-slate-500">
                Email
              </dt>

              <dd className="break-all font-medium">
                {user.email}
              </dd>
            </div>

            <div>
              <dt className="text-sm text-slate-500">
                Role
              </dt>

              <dd className="font-medium">
                {profile.role}
              </dd>
            </div>

            <div>
              <dt className="text-sm text-slate-500">
                Account status
              </dt>

              <dd className="font-medium text-[#087A68]">
                {profile.account_status}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="forecast-heading">
          <div className="mb-5">
            <h2
              id="forecast-heading"
              className="text-2xl font-bold"
            >
              Kitchen forecast
            </h2>

            <p className="mt-2 text-sm text-slate-600">
              Up to 21 meals whose serving time has not
              ended. All times are in IST. Refresh to load
              the latest choices.
            </p>
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800"
            >
              Could not load the kitchen forecast. Please
              refresh to try again.
            </div>
          ) : meals.length === 0 ? (
            <div className="rounded-2xl bg-[#EFF5F7] p-8 text-center">
              <h3 className="text-lg font-semibold">
                No upcoming meals
              </h3>

              <p className="mt-2 text-slate-600">
                Create a meal to start collecting student
                choices.
              </p>

              <Link
                href="/admin/meals"
                className="mt-4 inline-block font-semibold text-[#087A68] hover:underline"
              >
                Create your first meal →
              </Link>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {meals.map((meal) => {
                const choicesClosed =
                  now >= new Date(meal.cutoff_at).getTime();

                return (
                  <article
                    key={meal.meal_slot_id}
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-slate-500">
                          {formatMealDate(meal.meal_date)}
                        </p>

                        <h3 className="mt-1 text-xl font-bold">
                          {mealNames[meal.meal_type] ||
                            meal.meal_type}
                        </h3>
                      </div>

                      <span className="shrink-0 rounded-full bg-[#EFF5F7] px-3 py-1.5 font-semibold text-[#087A68]">
                        {formatPrice(meal.price_paise)}
                      </span>
                    </div>

                    <p className="mt-4 whitespace-pre-wrap break-words text-slate-700">
                      {meal.menu}
                    </p>

                    <dl className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-emerald-50 p-4">
                        <dt className="text-sm font-medium text-emerald-800">
                          Expected diners
                        </dt>

                        <dd className="mt-2 text-3xl font-bold text-emerald-900">
                          {meal.opted_in}
                        </dd>
                      </div>

                      <div className="rounded-xl bg-amber-50 p-4">
                        <dt className="text-sm font-medium text-amber-800">
                          Skipping
                        </dt>

                        <dd className="mt-2 text-3xl font-bold text-amber-900">
                          {meal.opted_out}
                        </dd>
                      </div>
                    </dl>

                    <dl className="mt-5 space-y-3 text-sm">
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

                        <dd className="font-medium">
                          {formatDateTime(meal.cutoff_at)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-5 border-t border-slate-100 pt-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          choicesClosed
                            ? "bg-slate-100 text-slate-700"
                            : "bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {choicesClosed
                          ? "Student choices closed"
                          : "Student choices open"}
                      </span>

                      <p className="mt-3 text-xs text-slate-500">
                        Counts reflect saved choices.
                        Students with no saved choice are
                        not included.
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8">
          Loading kitchen forecast…
        </p>
      }
    >
      <AdminDashboard />
    </Suspense>
  );
}