import { Suspense } from "react";
import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  EditMenuForm,
  type EditableMeal,
} from "./edit-menu-form";

async function EditMenuContent() {
  await requireRole("ADMIN");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("meal_slots")
    .select("id, meal_date, meal_type, menu, cutoff_at")
    .gt("cutoff_at", new Date().toISOString())
    .order("serve_start", { ascending: true })
    .limit(100);

  if (error) {
    console.error("Failed to load editable meals:", {
      code: error.code,
      message: error.message,
    });
  }

  const meals: EditableMeal[] = data ?? [];

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-[#087A68] hover:underline"
      >
        ← Back to kitchen overview
      </Link>

      <header className="mb-8 mt-4">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#087A68]">
          Kitchen administration
        </p>

        <h1 className="mt-2 text-3xl font-bold text-[#152D33]">
          Edit meal menu
        </h1>

        <p className="mt-3 text-slate-600">
          Update an upcoming meal before its cutoff time.
          Saved changes will appear on the student meal list.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800"
        >
          We could not load the meals. Refresh the page and try again.
        </div>
      ) : (
        <EditMenuForm meals={meals} />
      )}

      <p className="mt-6 text-sm text-slate-600">
        Need another meal?{" "}
        <Link
          href="/admin/meals"
          className="font-semibold text-[#087A68] hover:underline"
        >
          Create a meal
        </Link>
      </p>
    </main>
  );
}

export default function EditMenuPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600" role="status">
          Loading editable meals…
        </div>
      }
    >
      <EditMenuContent />
    </Suspense>
  );
}