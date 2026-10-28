import { Suspense } from "react";
import { redirect } from "next/navigation";

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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

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
            Signed in as{" "}
            {profile.full_name || "Scanner staff"}
          </p>
        </div>

        <DashboardLogoutButton />
      </header>

      <div className="mb-6 space-y-3 rounded-2xl bg-[#EFF5F7] p-5">
        <p className="text-sm leading-6 text-[#152D33]">
          Select the meal being served and scan the
          student&apos;s current QR pass. An online
          Accepted result confirms the collection.
          Offline acceptance is provisional until
          synchronization succeeds.
        </p>

        <p className="text-sm leading-6 text-slate-600">
          Prepare offline scanning while connected.
          Preparation lasts up to 15 minutes and never
          beyond the meal&apos;s serving window.
          Keep this page open while scanning offline.
        </p>

        <p className="text-sm leading-6 text-slate-600">
          Sync pending scans before logging out or
          switching devices. Reloading requires online
          preparation again before capturing new offline
          scans. Previously saved scans remain available
          for synchronization on this browser.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
        >
          Unable to load serving meals. Refresh to try
          again. You can still attempt to synchronize
          previously saved scans.
        </div>
      )}

      <MealScanner
        key={user.id}
        meals={error ? [] : meals}
        scannerId={user.id}
      />
    </main>
  );
}

export default function ScannerPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-slate-600">
          Loading meal scanner…
        </p>
      }
    >
      <ScannerContent />
    </Suspense>
  );
}