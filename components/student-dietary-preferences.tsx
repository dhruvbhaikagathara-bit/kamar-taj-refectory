import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { DietaryPreferenceForm } from "@/components/dietary-preference-form";

export async function StudentDietaryPreferences() {
  const { user } = await requireRole("STUDENT");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("dietary_preferences")
    .select("preference, notes")
    .eq("student_id", user.id)
    .maybeSingle();

  return (
    <section
      aria-labelledby="dietary-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 id="dietary-heading" className="text-xl font-semibold">
        Dietary preference
      </h2>

      <p className="mt-2 text-sm text-slate-600">
        Save your food preference and preparation requests.
        This does not change your meal selections.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800"
        >
          Could not load your dietary preference. Please refresh to try again.
        </p>
      ) : (
        <DietaryPreferenceForm
          initialPreference={data?.preference ?? ""}
          initialNotes={data?.notes ?? ""}
        />
      )}
    </section>
  );
}