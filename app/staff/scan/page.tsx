import { Suspense } from "react";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { DashboardLogoutButton } from "@/components/dashboard-logout-button";
import {
  MealScanner,
  type ScannerMeal,
} from "@/components/meal-scanner";

async function ScannerContent() {
  const { profile } = await requireRole("SCANNER_STAFF");
  const supabase = await createClient();

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("meal_slots")
    .select(
      "id, meal_date, meal_type, menu, serve_start, serve_end"
    )
    .lte("serve_start", now)
    .gt("serve_end", now)
    .order("serve_start", { ascending: true })
    .limit(60);

  const meals = (data ?? []) as ScannerMeal[];

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-[#087A68]">
            Scanner staff
          </p>

          <h1 className="mt-2 text-3xl font-bold text-[#152D33]">
            Meal check-in
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Signed in as {profile.full_name || "Scanner staff"}
          </p>
        </div>

        <DashboardLogoutButton />
      </header>

      <div className="mb-6 rounded-2xl bg-[#EFF5F7] p-5">
        <p className="text-sm text-[#152D33]">
          Select the meal being served, then scan the student's
          current QR pass. Serve the meal only after an Accepted
          result.
        </p>

        <p className="mt-2 text-sm text-slate-600">
          Only meals currently inside their serving window appear.
          Refresh this page when a new serving window begins.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800"
        >
          Unable to load meals. Refresh the page and try again.
        </div>
      ) : (
        <MealScanner meals={meals} />
      )}
    </main>
  );
}

export default function ScannerPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600" role="status">
          Loading meal scanner…
        </div>
      }
    >
      <ScannerContent />
    </Suspense>
  );
}