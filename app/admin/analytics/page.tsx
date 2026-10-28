import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsRefresh } from "@/components/analytics-refresh";
import { ConsumptionCharts } from "@/components/consumption-charts";
import { MealWasteForm } from "@/components/meal-waste-form";
import type { MealWasteReport } from "@/lib/meal-waste-types";
import {
  formatIndiaTime,
  getIndiaDate,
  isAnalyticsDate,
  type MealAnalytics,
} from "@/lib/meal-analytics";
import { MealSurplusForm } from "@/components/meal-surplus-form";
import {
  isSurplusAvailable,
  isSurplusExpired,
  type MealSurplusReport,
} from "@/lib/meal-surplus-types";

type PageProps = {
  searchParams: Promise<{
    date?: string | string[];
  }>;
};

function mealLabel(value: string) {
  const labels: Record<string, string> = {
    BREAKFAST: "Breakfast",
    LUNCH: "Lunch",
    DINNER: "Dinner",
  };

  return labels[value] ?? value;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatKg(grams: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(grams / 1000);
}

function getMealStatus(
  meal: MealAnalytics,
  now: number
) {
  if (now >= Date.parse(meal.serve_end)) return "Ended";
  if (now >= Date.parse(meal.serve_start)) return "Serving";
  if (now >= Date.parse(meal.cutoff_at)) {
    return "Choices locked";
  }

  return "Planning";
}

async function AnalyticsContent({
  searchParams,
}: PageProps) {
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
        <h1 className="text-2xl font-bold">
          Invalid date
        </h1>

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
    { p_meal_date: date }
  );

  if (error) {
    return (
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-bold">
          Meal analytics
        </h1>

        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-red-800"
        >
          Unable to load analytics. Please refresh.
        </p>

        <AnalyticsRefresh />
      </main>
    );
  }

  const meals = (data ?? []) as MealAnalytics[];
  let surplusReports: MealSurplusReport[] = [];
let surplusLoadFailed = false;

if (meals.length > 0) {
  const surplusResult = await supabase
    .from("meal_surplus_reports")
    .select(
      "meal_slot_id, portions, collect_by, status, recipient, notes, version, created_by, updated_by, created_at, updated_at"
    )
    .in(
      "meal_slot_id",
      meals.map((meal) => meal.id)
    );

  if (surplusResult.error) {
    surplusLoadFailed = true;
  } else {
    surplusReports =
      (surplusResult.data ?? []) as MealSurplusReport[];
  }
}

  let reports: MealWasteReport[] = [];
  let wasteLoadFailed = false;

  if (meals.length > 0) {
    const result = await supabase
      .from("meal_waste_reports")
      .select(
        "meal_slot_id, prepared_portions, leftover_portions, waste_grams, notes, version, created_by, updated_by, created_at, updated_at"
      )
      .in(
        "meal_slot_id",
        meals.map((meal) => meal.id)
      );

    if (result.error) {
      wasteLoadFailed = true;
    } else {
      reports = (result.data ?? []) as MealWasteReport[];
    }
  }

  // eslint-disable-next-line react-hooks/purity -- Read the server clock after authentication and database access.
  const now = Date.now();
  const surplusByMeal = new Map(
  surplusReports.map((report) => [
    report.meal_slot_id,
    report,
  ])
);

const availableSurplus = surplusReports.filter((report) =>
  isSurplusAvailable(report, now)
);

const assignedSurplus = surplusReports.filter(
  (report) =>
    report.status === "ASSIGNED" &&
    !isSurplusExpired(report, now)
);

const expiredSurplus = surplusReports.filter((report) =>
  isSurplusExpired(report, now)
);

const availablePortions = availableSurplus.reduce(
  (sum, report) => sum + report.portions,
  0
);

const assignedPortions = assignedSurplus.reduce(
  (sum, report) => sum + report.portions,
  0
);

const redistributedPortions = surplusReports
  .filter((report) => report.status === "COLLECTED")
  .reduce((sum, report) => sum + report.portions, 0);

const surplusCards = [
  [
    "Available for redistribution",
    formatCount(availablePortions),
  ],
  [
    "Assigned · awaiting pickup",
    formatCount(assignedPortions),
  ],
  [
    "Redistributed portions",
    formatCount(redistributedPortions),
  ],
  [
    "Expired batches · needs review",
    formatCount(expiredSurplus.length),
  ],
];

const collectionDeadlineFormatter = new Intl.DateTimeFormat(
  "en-IN",
  {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }
);

  const reportByMeal = new Map(
    reports.map((report) => [
      report.meal_slot_id,
      report,
    ])
  );

  const endedMeals = meals.filter(
    (meal) => Date.parse(meal.serve_end) <= now
  );

  const expectedTotal = meals.reduce(
    (sum, meal) => sum + meal.expected_count,
    0
  );

  const collectedTotal = meals.reduce(
    (sum, meal) => sum + meal.collected_count,
    0
  );

  const optedOutTotal = meals.reduce(
    (sum, meal) => sum + meal.opted_out_count,
    0
  );

  const uncollectedEstimate = endedMeals.reduce(
    (sum, meal) =>
      sum +
      Math.max(
        meal.expected_count - meal.collected_count,
        0
      ),
    0
  );

  const preparedTotal = reports.reduce(
    (sum, report) => sum + report.prepared_portions,
    0
  );

  const leftoverTotal = reports.reduce(
    (sum, report) => sum + report.leftover_portions,
    0
  );

  const wasteTotal = reports.reduce(
    (sum, report) => sum + report.waste_grams,
    0
  );

  const missingEndedReports = endedMeals.filter(
    (meal) => !reportByMeal.has(meal.id)
  ).length;

  const leftoverPercentage =
    preparedTotal > 0
      ? (leftoverTotal / preparedTotal) * 100
      : null;

  const maximumWaste = Math.max(
    1,
    ...reports.map((report) => report.waste_grams)
  );

  const consumptionCards = [
    ["Expected meals", formatCount(expectedTotal)],
    ["Collected meals", formatCount(collectedTotal)],
    ["Opted-out choices", formatCount(optedOutTotal)],
    [
      "Uncollected · ended meals",
      endedMeals.length
        ? formatCount(uncollectedEstimate)
        : "—",
    ],
  ];

  const wasteCards = [
    [
      "Prepared portions",
      reports.length ? formatCount(preparedTotal) : "—",
    ],
    [
      "Leftover portions",
      reports.length ? formatCount(leftoverTotal) : "—",
    ],
    [
      "Discarded food",
      reports.length ? `${formatKg(wasteTotal)} kg` : "—",
    ],
    [
      "Leftover portion rate",
      leftoverPercentage === null
        ? "—"
        : `${leftoverPercentage.toFixed(1)}%`,
    ],
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-7 p-4 sm:p-6">
      <header className="space-y-2">
        <Link
          href="/admin"
          className="text-sm font-medium text-[#087A68] underline"
        >
          ← Back to kitchen overview
        </Link>

        <h1 className="text-3xl font-bold text-[#103C39]">
          Meal and waste analytics
        </h1>

        <p className="text-sm text-slate-600">
          Track meal collections and actual kitchen
          measurements. All dates and times use IST.
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <form
          method="GET"
          action="/admin/analytics"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="block text-sm font-medium">
            Meal date

            <input
              key={date}
              type="date"
              name="date"
              defaultValue={date}
              min="2000-01-01"
              max="2099-12-31"
              required
              className="mt-2 block min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#087A68]"
            />
          </label>

          <button
            type="submit"
            className="min-h-11 rounded-lg bg-[#087A68] px-4 py-2 font-medium text-white hover:bg-[#066452] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            View date
          </button>
        </form>

        <AnalyticsRefresh />
      </div>

      <section
        aria-label="Consumption totals"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {consumptionCards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <p className="text-sm text-slate-600">
              {label}
            </p>
            <p className="mt-2 text-3xl font-bold text-[#103C39]">
              {value}
            </p>
          </div>
        ))}
      </section>

      {meals.length === 0 ? (
        <div className="rounded-2xl border bg-white p-8 text-center">
          <p>No meals scheduled for this date.</p>

          <Link
            href="/admin/meals"
            className="mt-3 inline-block text-[#087A68] underline"
          >
            Create a meal
          </Link>
        </div>
      ) : (
        <>
          <ConsumptionCharts meals={meals} />
          <section
  aria-labelledby="surplus-heading"
  className="space-y-5"
>
  <div>
    <h2
      id="surplus-heading"
      className="text-2xl font-bold text-[#103C39]"
    >
      Surplus redistribution
    </h2>

    <p className="mt-2 text-sm leading-6 text-slate-600">
      Kitchen-confirmed surplus for meals on the selected
      date. Assign available batches and record collection
      before their deadlines.
    </p>
  </div>

  {surplusLoadFailed ? (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
    >
      Surplus reports could not be loaded. Refresh before
      entering or updating a report. Consumption and waste
      analytics remain available.
    </div>
  ) : (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {surplusCards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <p className="text-sm text-slate-600">
              {label}
            </p>

            <p className="mt-2 text-3xl font-bold text-[#103C39]">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div aria-live="polite" aria-atomic="true">
        {availableSurplus.length > 0 ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <h3 className="font-bold text-amber-950">
              Redistribution alert:{" "}
              {formatCount(availablePortions)} portions
              available
            </h3>

            <p className="mt-2 text-sm text-amber-900">
              These batches are confirmed by the kitchen
              and have not yet been assigned.
            </p>

            <ul className="mt-4 space-y-3">
              {availableSurplus.map((report) => {
                const meal = meals.find(
                  (item) => item.id === report.meal_slot_id
                );

                return (
                  <li key={report.meal_slot_id}>
                    <a
                      href={`#surplus-meal-${report.meal_slot_id}`}
                      className="block rounded-xl border border-amber-200 bg-white p-4 text-sm text-amber-950 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                    >
                      <span className="font-semibold">
                        {meal
                          ? mealLabel(meal.meal_type)
                          : "Meal"}
                        {" · "}
                        {formatCount(report.portions)} portions
                      </span>

                      <span className="mt-1 block">
                        Collect by{" "}
                        {collectionDeadlineFormatter.format(
                          new Date(report.collect_by)
                        )}
                        {" IST"}
                      </span>

                      <span className="mt-2 block font-medium underline">
                        Open batch and assign recipient
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No unassigned, unexpired surplus is currently
            reported for this date.
          </p>
        )}
      </div>

      {assignedSurplus.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <h3 className="font-bold text-blue-950">
            Awaiting pickup
          </h3>

          <ul className="mt-3 space-y-3">
            {assignedSurplus.map((report) => {
              const meal = meals.find(
                (item) => item.id === report.meal_slot_id
              );

              return (
                <li
                  key={report.meal_slot_id}
                  className="text-sm text-blue-950"
                >
                  <a
                    href={`#surplus-meal-${report.meal_slot_id}`}
                    className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    {meal
                      ? mealLabel(meal.meal_type)
                      : "Meal"}
                    {" · "}
                    {formatCount(report.portions)} portions
                    {" → "}
                    {report.recipient}
                  </a>

                  <p className="mt-1">
                    Collect by{" "}
                    {collectionDeadlineFormatter.format(
                      new Date(report.collect_by)
                    )}
                    {" IST"}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {expiredSurplus.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h3 className="font-bold text-red-900">
            Expired batches need review
          </h3>

          <p className="mt-2 text-sm text-red-800">
            These batches are excluded from available and
            assigned portion totals. Record their outcome
            below; expiry alone does not prove disposal.
          </p>

          <ul className="mt-3 space-y-2">
            {expiredSurplus.map((report) => {
              const meal = meals.find(
                (item) => item.id === report.meal_slot_id
              );

              return (
                <li key={report.meal_slot_id}>
                  <a
                    href={`#surplus-meal-${report.meal_slot_id}`}
                    className="rounded text-sm font-medium text-red-900 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                  >
                    Review{" "}
                    {meal
                      ? mealLabel(meal.meal_type)
                      : "meal"}
                    {" · "}
                    {formatCount(report.portions)} portions
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-5">
        {meals.map((meal) => {
          const report =
            surplusByMeal.get(meal.id) ?? null;

          return (
            <div
              key={meal.id}
              id={`surplus-meal-${meal.id}`}
              className="scroll-mt-6"
            >
              <MealSurplusForm
                mealId={meal.id}
                mealLabel={mealLabel(meal.meal_type)}
                canReport={
                  Date.parse(meal.serve_start) <= now
                }
                nowMilliseconds={now}
                report={report}
              />
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-6 text-slate-500">
        These alerts appear inside the admin dashboard;
        they do not send messages to recipients.
        Redistributed portions are recorded separately
        from student QR collections. Waste measurements
        must still be entered in the kitchen waste report.
      </p>
    </>
  )}
</section>

          <section aria-labelledby="meal-details-heading">
            <h2
              id="meal-details-heading"
              className="mb-4 text-xl font-bold text-[#103C39]"
            >
              Individual meal details
            </h2>

            <div className="grid gap-4 lg:grid-cols-3">
              {meals.map((meal) => {
                const status = getMealStatus(meal, now);

                return (
                  <article
                    key={meal.id}
                    className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-bold text-[#103C39]">
                        {mealLabel(meal.meal_type)}
                      </h3>

                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {status}
                      </span>
                    </div>

                    <p className="break-words text-sm text-slate-700">
                      {meal.menu}
                    </p>

                    <div className="space-y-1 text-xs text-slate-600">
                      <p>
                        Cutoff:{" "}
                        {formatIndiaTime(meal.cutoff_at)}
                      </p>
                      <p>
                        Serving:{" "}
                        {formatIndiaTime(meal.serve_start)}
                        {" – "}
                        {formatIndiaTime(meal.serve_end)}
                      </p>
                    </div>

                    <dl className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <dt className="text-xs text-emerald-800">
                          Expected
                        </dt>
                        <dd className="mt-1 text-2xl font-bold text-[#087A68]">
                          {formatCount(meal.expected_count)}
                        </dd>
                      </div>

                      <div className="rounded-xl bg-orange-50 p-3">
                        <dt className="text-xs text-orange-800">
                          Collected
                        </dt>
                        <dd className="mt-1 text-2xl font-bold text-orange-700">
                          {formatCount(meal.collected_count)}
                        </dd>
                      </div>
                    </dl>

                    <p className="text-sm text-slate-600">
                      Opted-out choices:{" "}
                      {formatCount(meal.opted_out_count)}
                    </p>

                    {status === "Ended" && (
                      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                        Uncollected estimate:{" "}
                        {formatCount(
                          Math.max(
                            meal.expected_count -
                              meal.collected_count,
                            0
                          )
                        )}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="waste-heading"
            className="space-y-5"
          >
            <div>
              <h2
                id="waste-heading"
                className="text-2xl font-bold text-[#103C39]"
              >
                Kitchen waste analysis
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                Actual reports entered by the kitchen.
                Leftover portions and discarded food
                weight are separate measurements.
              </p>
            </div>

            {wasteLoadFailed ? (
              <div
                role="alert"
                className="rounded-xl bg-red-50 p-5 text-sm text-red-800"
              >
                Waste reports could not be loaded.
                Refresh the page before entering a report.
                Consumption analytics remains available.
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-[#EFF5F7] p-4 text-sm leading-6 text-slate-700">
                  Reports recorded: {reports.length} of{" "}
                  {meals.length} scheduled meals.
                  {" "}
                  {missingEndedReports} ended meals still
                  need a report.
                  {" "}
                  Totals below cover recorded reports only.
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {wasteCards.map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-slate-200 bg-white p-5"
                    >
                      <p className="text-sm text-slate-600">
                        {label}
                      </p>
                      <p className="mt-2 text-3xl font-bold text-[#103C39]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                  <h3 className="text-lg font-bold text-[#103C39]">
                    Discarded food by meal
                  </h3>

                  <p className="mt-2 text-sm text-slate-600">
                    Measured weight in kilograms.
                    Unrecorded meals are not treated as
                    zero waste.
                  </p>

                  <ul className="mt-6 space-y-5">
                    {meals.map((meal) => {
                      const report = reportByMeal.get(
                        meal.id
                      );

                      return (
                        <li key={meal.id}>
                          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium">
                              {mealLabel(meal.meal_type)}
                            </span>

                            <span className="font-semibold text-slate-700">
                              {report
                                ? `${formatKg(
                                    report.waste_grams
                                  )} kg`
                                : "Not recorded"}
                            </span>
                          </div>

                          {report ? (
                            <div
                              aria-hidden="true"
                              className="h-6 overflow-hidden rounded-md bg-slate-100"
                            >
                              <div
                                className="h-full rounded-md bg-orange-500"
                                style={{
                                  width: `${
                                    (report.waste_grams /
                                      maximumWaste) *
                                    100
                                  }%`,
                                }}
                              />
                            </div>
                          ) : (
                            <div
                              aria-hidden="true"
                              className="h-6 rounded-md border border-dashed border-slate-300"
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <p className="mt-5 text-xs leading-5 text-slate-500">
                    Leftover portion rate = leftover
                    portions ÷ prepared portions.
                    This is not a food-waste weight
                    percentage. Prepared food weight
                    is not recorded.
                  </p>
                </article>

                <div className="space-y-5">
                  {meals.map((meal) => {
                    const report =
                      reportByMeal.get(meal.id) ?? null;

                    return (
                      <MealWasteForm
                        key={`${meal.id}-${report?.version ?? 0}`}
                        mealId={meal.id}
                        mealLabel={mealLabel(meal.meal_type)}
                        canRecord={
                          Date.parse(meal.serve_end) <= now
                        }
                        report={report}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}

      <p className="text-xs leading-6 text-slate-600">
        Expected counts use current active enrollments,
        not a saved cutoff snapshot. Recorded collections
        remain even if an account changes. Uncollected
        meals do not prove food was wasted. Waste totals
        depend on kitchen measurements and report coverage.
        Opted-out choices do not necessarily represent
        refunded cancellations.
      </p>
    </main>
  );
}

export default function AnalyticsPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-slate-600">
          Loading meal and waste analytics…
        </p>
      }
    >
      <AnalyticsContent {...props} />
    </Suspense>
  );
}