import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { DashboardLogoutButton } from "@/components/dashboard-logout-button";
import { CreateMealForm } from "./create-meal-form";

async function MealManagement() {
  await requireRole("ADMIN");

  return (
    <main className="min-h-screen bg-[#FAFCFC] px-6 py-12 text-[#152D33]">
      <div className="mx-auto max-w-3xl space-y-8">
        <nav className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/admin"
            className="font-semibold text-[#087A68] hover:underline"
          >
            ← Admin dashboard
          </Link>

          <DashboardLogoutButton />
        </nav>

        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#087A68]">
            Kamar-Taj Refectory
          </p>

          <h1 className="mt-3 text-3xl font-bold">Create a meal</h1>

          <p className="mt-2 text-slate-600">
            Set the menu, price, meal-choice deadline, and serving times.
          </p>
        </header>

        <section
          aria-label="Create meal form"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <CreateMealForm />
        </section>
      </div>
    </main>
  );
}

export default function MealsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading meal management...</p>}>
      <MealManagement />
    </Suspense>
  );
}