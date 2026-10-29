import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Wallet,
} from "lucide-react";

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

function mealName(type: string) {
  return mealNames[type] ?? type;
}

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
    enrollments.map((entry) => [
      entry.meal_slot_id,
      entry.status,
    ])
  );

  // eslint-disable-next-line react-hooks/purity -- Pass a request-time server clock to the choice controls.
  const serverNow = Date.now();

  const nextMeal = meals[0] ?? null;
  const nextChoice = nextMeal
    ? choiceByMeal.get(nextMeal.id)
    : undefined;

  const optedInCount = enrollments.filter(
    (entry) => entry.status === "OPTED_IN"
  ).length;

  const optedOutCount = enrollments.filter(
    (entry) => entry.status === "OPTED_OUT"
  ).length;

  return (
    <main className="min-h-screen bg-[#F5F8F7] px-4 py-6 text-[#152D33] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Kamar-Taj <span className="mx-2">/</span>{" "}
            Student overview
          </p>

          <DashboardLogoutButton />
        </div>

        <header>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="break-words text-3xl font-bold tracking-tight sm:text-4xl">
                Your meals, made simple.
              </h1>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                Welcome, {profile.full_name || "Student"}.
                Plan your meals, open your pass, and track
                your rebates in one place.
              </p>
            </div>

            <span className="inline-flex items-center gap-2 rounded-full bg-[#E3F5EB] px-3 py-1.5 text-xs font-semibold text-[#08634C]">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-[#087A68]"
              />
              {profile.account_status === "ACTIVE"
                ? "Account active"
                : profile.account_status}
            </span>
          </div>
        </header>

        <section
          aria-labelledby="next-meal-heading"
          className="relative overflow-hidden rounded-3xl bg-[#103C39] p-6 text-white shadow-sm sm:p-8"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-24 hidden h-80 w-80 rounded-full border border-white/10 sm:block"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-6 -top-14 hidden h-64 w-64 rounded-full border border-white/10 sm:block"
          />

         <div className="relative max-w-2xl lg:max-w-[58%]">
            {/* Decorative meal illustration */}
<div
  aria-hidden="true"
  className="pointer-events-none absolute right-8 top-1/2 hidden w-[270px] -translate-y-1/2 lg:block xl:right-14 xl:w-[310px]"
>
  <svg
    viewBox="0 0 320 320"
    fill="none"
    className="h-auto w-full drop-shadow-xl"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Plate shadow and rim */}
    <circle cx="160" cy="166" r="145" fill="#082F2C" opacity="0.5" />
    <circle cx="160" cy="156" r="145" fill="#CAD7CE" />
    <circle cx="160" cy="151" r="139" fill="#F8FAF3" />
    <circle cx="160" cy="151" r="123" fill="#E4EADF" />
    <circle cx="160" cy="151" r="115" fill="#F8F9F0" />

    {/* Curry */}
    <circle cx="111" cy="119" r="48" fill="#C95E33" />
    <circle cx="111" cy="117" r="42" fill="#E99547" />
    <circle cx="95" cy="106" r="8" fill="#C95432" />
    <circle cx="121" cy="127" r="10" fill="#C95432" />
    <circle cx="133" cy="103" r="7" fill="#C95432" />
    <circle cx="96" cy="133" r="6" fill="#D46C34" />
    <path d="M104 94l8 4-5 4-7-4z" fill="#5E9B50" />
    <path d="M126 113l8-3-1 6-7 2z" fill="#5E9B50" />
    <path d="M97 119l6 3-4 4-6-3z" fill="#5E9B50" />

    {/* Rice */}
    <ellipse cx="188" cy="88" rx="46" ry="34" fill="#F1EED9" />
    <ellipse cx="176" cy="80" rx="7" ry="3" fill="#DCD6B1" transform="rotate(-20 176 80)" />
    <ellipse cx="195" cy="77" rx="7" ry="3" fill="#DCD6B1" transform="rotate(18 195 77)" />
    <ellipse cx="207" cy="92" rx="7" ry="3" fill="#DCD6B1" transform="rotate(12 207 92)" />
    <ellipse cx="183" cy="99" rx="7" ry="3" fill="#DCD6B1" transform="rotate(-18 183 99)" />
    <ellipse cx="198" cy="105" rx="6" ry="3" fill="#DCD6B1" transform="rotate(20 198 105)" />

    {/* Roti */}
    <circle cx="203" cy="175" r="56" fill="#DBA064" />
    <path
      d="M160 159c16-13 28-12 43-17 11-4 20-11 28-10"
      stroke="#EFC18C"
      strokeWidth="10"
      strokeLinecap="round"
    />
    <path
      d="M158 182c18-13 31-14 44-20 14-7 24-14 38-12"
      stroke="#EFC18C"
      strokeWidth="10"
      strokeLinecap="round"
    />
    <path
      d="M174 213c9-16 19-24 32-30 12-6 23-10 32-8"
      stroke="#EFC18C"
      strokeWidth="10"
      strokeLinecap="round"
    />

    {/* Greens */}
    <circle cx="105" cy="195" r="40" fill="#72AB5F" />
    <ellipse cx="97" cy="187" rx="17" ry="9" fill="#3D853F" transform="rotate(35 97 187)" />
    <ellipse cx="119" cy="183" rx="17" ry="9" fill="#3D853F" transform="rotate(-35 119 183)" />
    <ellipse cx="107" cy="204" rx="16" ry="9" fill="#438E45" transform="rotate(-10 107 204)" />
    <path
      d="M106 211c2-15 5-25 13-34"
      stroke="#347A3B"
      strokeWidth="4"
      strokeLinecap="round"
    />

    {/* Small garnish */}
    <circle cx="78" cy="158" r="13" fill="#EEC873" />
    <circle cx="252" cy="213" r="13" fill="#D96B45" />
    <circle cx="248" cy="210" r="9" fill="#F1B45F" />
  </svg>
</div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100/80">
              Upcoming meal
            </p>

            <h2
              id="next-meal-heading"
              className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
            >
              Good food.
              <br />
              Zero guesswork.
            </h2>

            {error ? (
              <p
                role="alert"
                className="mt-4 text-sm leading-6 text-emerald-50"
              >
                We couldn’t load your next meal. Refresh
                the page to try again.
              </p>
            ) : nextMeal ? (
              <>
                <p className="mt-4 text-sm font-semibold text-white">
                  {mealName(nextMeal.meal_type)}
                  {" · "}
                  {formatMealDate(nextMeal.meal_date)}
                </p>

                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-emerald-50/85">
                  {nextMeal.menu}
                </p>

                <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-emerald-100/80">
                  <Clock3
                    size={15}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    Serving {formatDateTime(nextMeal.serve_start)}
                    {" – "}
                    {formatDateTime(nextMeal.serve_end)} IST
                  </span>
                </p>

                <p className="mt-2 text-xs text-emerald-100/80">
                  {choicesFailed
                    ? "Meal choice could not be loaded."
                    : nextChoice === "OPTED_IN"
                      ? "Your choice: opted in."
                      : nextChoice === "OPTED_OUT"
                        ? "Your choice: opted out."
                        : "No saved choice is shown for this meal."}
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm leading-6 text-emerald-50/85">
                Your next meal will appear here when the
                kitchen publishes one.
              </p>
            )}

            <Link
              href="/student/qr"
              className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#103C39] transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#103C39]"
            >
              Open meal pass
              <ArrowRight size={16} aria-hidden="true" />
            </Link>

            <p className="mt-3 text-xs leading-5 text-emerald-100/75">
              A pass is available for eligible meals during
              their serving window.
            </p>
          </div>
        </section>

        <section
          aria-label="Meal summary"
          className="grid gap-4 sm:grid-cols-3"
        >
          <div className="rounded-2xl border border-[#E1EAE6] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-600">
                Upcoming meals
              </p>
              <span className="rounded-lg bg-emerald-50 p-2 text-[#087A68]">
                <CalendarDays size={18} aria-hidden="true" />
              </span>
            </div>

            <p className="mt-3 text-3xl font-bold tracking-tight text-[#103C39]">
              {error ? "—" : meals.length}
            </p>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Up to 21 meals shown
            </p>
          </div>

          <div className="rounded-2xl border border-[#E1EAE6] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-600">
                Your meal choices
              </p>
              <span className="rounded-lg bg-[#EFF5F7] p-2 text-[#087A68]">
                <CheckCircle2 size={18} aria-hidden="true" />
              </span>
            </div>

            <p className="mt-3 text-3xl font-bold tracking-tight text-[#103C39]">
              {error || choicesFailed ? "—" : optedInCount}
            </p>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Opted in
              {!error && !choicesFailed && (
                <> · {optedOutCount} opted out</>
              )}
              {" "}among meals shown
            </p>
          </div>

          <div className="rounded-2xl border border-[#E1EAE6] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-600">
                Rebate wallet
              </p>
              <span className="rounded-lg bg-orange-50 p-2 text-orange-700">
                <Wallet size={18} aria-hidden="true" />
              </span>
            </div>

            <p className="mt-3 text-lg font-bold text-[#103C39]">
              Your credits
            </p>

            <Link
              href="/student/billing"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#087A68] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              View rebate history
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section
  aria-labelledby="upcoming-meals-heading"
  className="rounded-2xl border border-[#E1EAE6] bg-white p-5 shadow-sm sm:p-6"
>
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2
        id="upcoming-meals-heading"
        className="text-lg font-bold tracking-tight text-[#103C39]"
      >
        Next on your menu
      </h2>

      <p className="mt-1 text-xs leading-5 text-slate-500">
        Select a meal to view details and change your choice.
        Times are in IST.
      </p>
    </div>

    <Link
      href="/student/planner"
      className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[#087A68] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      View meal planner
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  </div>

  {error ? (
    <p
      role="alert"
      className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      Could not load meals. Please refresh the page.
    </p>
  ) : meals.length === 0 ? (
    <div className="mt-5 rounded-xl bg-slate-50 p-6 text-center">
      <h3 className="font-semibold text-[#103C39]">
        No upcoming meals yet
      </h3>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Meals will appear here after the kitchen publishes them.
      </p>
    </div>
  ) : (
    <>
      {choicesFailed && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
        >
          Could not load your saved choices. Please refresh
          before making changes.
        </p>
      )}

      <div className="mt-4 divide-y divide-[#E8EEEB] border-t border-[#E8EEEB]">
        {meals.map((meal) => {
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

          const choiceColor =
            !choicesFailed && choice === "OPTED_IN"
              ? "bg-[#E3F5EB] text-[#08634C]"
              : !choicesFailed && choice === "OPTED_OUT"
                ? "bg-orange-50 text-orange-800"
                : "bg-slate-100 text-slate-700";

          return (
            <details key={meal.id} className="group">
              <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 rounded-lg py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF0E6] text-xl"
                >
                  🍲
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[#152D33]">
                    {mealName(meal.meal_type)}
                  </span>

                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {formatMealDate(meal.meal_date)}
                    {" · "}
                    {formatDateTime(meal.serve_start)}
                    {" – "}
                    {formatDateTime(meal.serve_end)}
                  </span>
                </span>

                <span className="flex max-w-[40%] shrink-0 flex-col items-end gap-1 text-right">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${choiceColor}`}
                  >
                    {choiceLabel}
                  </span>

                  <span className="line-clamp-1 break-all text-xs text-slate-500">
                    {meal.menu}
                  </span>

                  <span className="text-xs font-medium text-[#087A68]">
                    <span className="group-open:hidden">
                      View details
                    </span>
                    <span className="hidden group-open:inline">
                      Hide details
                    </span>
                  </span>
                </span>
              </summary>

              <div className="mb-4 rounded-xl bg-[#F8FAF9] p-4 sm:ml-14 sm:p-5">
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                  {meal.menu}
                </p>

                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">
                      Meal price
                    </dt>
                    <dd className="mt-1 font-semibold text-[#103C39]">
                      {formatPrice(meal.price_paise)}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-slate-500">
                      Meal-choice deadline
                    </dt>
                    <dd className="mt-1 font-semibold text-[#103C39]">
                      {formatDateTime(meal.cutoff_at)} IST
                      {locked && (
                        <span className="ml-2 text-xs text-slate-500">
                          · Locked
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>

                {!choicesFailed && (
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
</section>

        <StudentDietaryPreferences />

        <details className="rounded-2xl border border-[#E1EAE6] bg-white p-5 shadow-sm">
          <summary className="min-h-11 cursor-pointer font-semibold text-[#103C39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
            Your account details
          </summary>

          <dl className="mt-4 grid gap-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Email</dt>
              <dd className="mt-1 break-all font-medium">
                {user.email}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500">Role</dt>
              <dd className="mt-1 font-medium">
                {profile.role}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500">
                Account status
              </dt>
              <dd className="mt-1 font-medium">
                {profile.account_status}
              </dd>
            </div>
          </dl>
        </details>
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