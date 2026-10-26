import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsRefresh } from "@/components/analytics-refresh";
import {
  formatIndiaTime,
  getIndiaDate,
  isAnalyticsDate,
  type MealAnalytics,
} from "@/lib/meal-analytics";

type PageProps = {
  searchParams: Promise<{
    date?: string | string[];
  }>;
};

function getMealStatus(meal: MealAnalytics, now: number) {
  if (now >= Date.parse(meal.serve_end)) return "Ended";
  if (now >= Date.parse(meal.serve_start)) return "Serving";
  if (now >= Date.parse(meal.cutoff_at)) return "Choices locked";
  return "Planning";
}

function ComparisonBar({
  label,
  value,
  maximum,
  color,
}: {
  label: string;
  value: number;
  maximum: number;
  color: string;
}) {
  const percentage = Math.min(
    100,
    Math.max(0, (value / maximum) * 100),
  );

  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-semibold">{value}</span>
      </div>

      <div
        aria-hidden="true"
        className="h-3 overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

async function AnalyticsContent({ searchParams }: PageProps) {
  await requireRole("ADMIN");

  const params = await searchParams;

  const date =
    params.date === undefined
      ? getIndiaDate()
      : typeof params.date === "string"
        ? params.date
        : "";

  if (!isAnalyticsDate(date)) {
    return (
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Invalid date</h1>

        <Link
          href="/admin/analytics"
          className="text-[#087A68] underline"
        >
          Open today’s analytics
        </Link>
      </main>
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_admin_meal_analytics",
    { p_meal_date: date },
  );

  if (error) {
    return (
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">Meal analytics</h1>

        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-red-800"
        >
          Unable to load analytics. Please try refreshing.
        </p>

        <AnalyticsRefresh />
      </main>
    );
  }

  const meals = (data ?? []) as MealAnalytics[];
 // eslint-disable-next-line react-hooks/purity -- Read the server clock after authentication and uncached database access.
const now = Date.now();

  const total = (key: keyof Pick<
    MealAnalytics,
    | "expected_count"
    | "collected_count"
    | "opted_out_count"
    | "vegetarian_count"
    | "nonvegetarian_count"
    | "vegan_count"
    | "jain_count"
    | "unspecified_count"
  >) => meals.reduce((sum, meal) => sum + meal[key], 0);

  const endedMeals = meals.filter(
    (meal) => Date.parse(meal.serve_end) <= now,
  );

  const uncollectedEstimate = endedMeals.reduce(
    (sum, meal) =>
      sum + Math.max(
        meal.expected_count - meal.collected_count,
        0,
      ),
    0,
  );

  const dietaryTotals = [
    ["Vegetarian", total("vegetarian_count")],
    ["Non-vegetarian", total("nonvegetarian_count")],
    ["Vegan", total("vegan_count")],
    ["Jain", total("jain_count")],
    ["Not specified", total("unspecified_count")],
  ] as const;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <Link
          href="/admin"
          className="text-sm font-medium text-[#087A68] underline"
        >
          ← Back to kitchen overview
        </Link>

        <h1 className="text-3xl font-bold text-[#103C39]">
          Meal analytics
        </h1>

        <p className="text-sm text-slate-600">
          Current eligible meal commitments and recorded collections.
          All times use India Standard Time.
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border bg-white p-4">
        <form
          method="GET"
          action="/admin/analytics"
          className="flex flex-wrap items-end gap-3"
        >
          <div className="space-y-1">
            <label
              htmlFor="analytics-date"
              className="block text-sm font-medium"
            >
              Meal date
            </label>

            <input
              key={date}
              id="analytics-date"
              type="date"
              name="date"
              defaultValue={date}
              min="2000-01-01"
              max="2099-12-31"
              required
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
            />
          </div>

          <button
            type="submit"
            className="rounded-lg bg-[#087A68] px-4 py-2 font-medium text-white hover:bg-[#066452]"
          >
            View date
          </button>
        </form>

        <AnalyticsRefresh />
      </div>

      <section
        aria-label="Daily totals"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {[
          ["Expected meals", total("expected_count")],
          ["Collected meals", total("collected_count")],
          ["Opted-out choices", total("opted_out_count")],
          [
            "Uncollected · ended meals",
            endedMeals.length ? uncollectedEstimate : "—",
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-xl border bg-white p-5"
          >
            <p className="text-sm text-slate-600">{label}</p>
            <p className="mt-2 text-3xl font-bold text-[#103C39]">
              {value}
            </p>
          </div>
        ))}
      </section>

      {meals.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center">
          <p className="font-medium">
            No meals scheduled for this date.
          </p>

          <Link
            href="/admin/meals"
            className="mt-3 inline-block text-[#087A68] underline"
          >
            Create a meal
          </Link>
        </div>
      ) : (
        <section
          aria-label="Expected versus collected meals"
          className="grid gap-4 lg:grid-cols-3"
        >
          {meals.map((meal) => {
            const maximum = Math.max(
              meal.expected_count,
              meal.collected_count,
              1,
            );

            const ended = Date.parse(meal.serve_end) <= now;

            return (
              <article
                key={meal.id}
                className="space-y-4 rounded-xl border bg-white p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-bold text-[#103C39]">
                    {meal.meal_type}
                  </h2>

                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">
                    {getMealStatus(meal, now)}
                  </span>
                </div>

                <p className="break-words text-sm text-slate-700">
                  {meal.menu}
                </p>

                <p className="text-xs text-slate-600">
                  Serving: {formatIndiaTime(meal.serve_start)}
                  {" – "}
                  {formatIndiaTime(meal.serve_end)}
                </p>

                <ComparisonBar
                  label="Expected"
                  value={meal.expected_count}
                  maximum={maximum}
                  color="bg-[#087A68]"
                />

                <ComparisonBar
                  label="Collected"
                  value={meal.collected_count}
                  maximum={maximum}
                  color="bg-[#F4A65B]"
                />

                <p className="text-sm text-slate-600">
                  Opted-out choices: {meal.opted_out_count}
                </p>

                {ended && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    Uncollected estimate:{" "}
                    {Math.max(
                      meal.expected_count - meal.collected_count,
                      0,
                    )}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}

      <section className="space-y-4 rounded-xl border bg-white p-5">
        <div>
          <h2 className="text-lg font-semibold text-[#103C39]">
            Expected portions by dietary preference
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            Counts include each active student’s opted-in meals for
            this date. One student can contribute more than one portion.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {dietaryTotals.map(([label, count]) => (
            <div
              key={label}
              className="rounded-lg bg-slate-50 p-4"
            >
              <p className="text-sm text-slate-600">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{count}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs leading-relaxed text-slate-600">
        Expected counts use current active enrollments, rather than a
        saved cutoff snapshot. Collections remain recorded even if a
        student’s account later changes. The uncollected figure is an
        estimate; prepared quantities and leftover food have not been
        measured. Opted-out choices can include students who never
        enrolled and do not necessarily represent refunded cancellations.
      </p>
    </main>
  );
}

export default function AnalyticsPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600">
          Loading meal analytics…
        </div>
      }
    >
      <AnalyticsContent {...props} />
    </Suspense>
  );
}