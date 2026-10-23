"use client";

import { useActionState, useState } from "react";
import { saveDietaryPreference } from "@/app/student/dietary-actions";

type Props = {
  initialPreference: string;
  initialNotes: string;
};

const initialState = {
  success: false,
  message: "",
};

const inputClass =
  "mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[#152D33] outline-none focus:border-[#087A68] focus:ring-2 focus:ring-[#087A68]/20";

export function DietaryPreferenceForm({
  initialPreference,
  initialNotes,
}: Props) {
  const [preference, setPreference] = useState(initialPreference);
  const [notes, setNotes] = useState(initialNotes);

  const [state, formAction, pending] = useActionState(
    saveDietaryPreference,
    initialState
  );

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Your dietary preference</legend>

        <div>
          <label
            htmlFor="dietary-preference"
            className="text-sm font-semibold"
          >
            Food preference
          </label>

          <select
            id="dietary-preference"
            name="preference"
            required
            value={preference}
            onChange={(event) => setPreference(event.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Select your preference
            </option>
            <option value="VEGETARIAN">Vegetarian</option>
            <option value="NON_VEGETARIAN">Non-vegetarian</option>
            <option value="VEGAN">Vegan</option>
            <option value="JAIN">Jain</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="dietary-notes"
            className="text-sm font-semibold"
          >
            Food notes — optional
          </label>

          <textarea
            id="dietary-notes"
            name="notes"
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Example: No onion or garlic"
            aria-describedby="dietary-notes-count"
            className={inputClass}
          />

          <p
            id="dietary-notes-count"
            className="mt-1 text-right text-xs text-slate-500"
          >
            {notes.length}/500 characters
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#087A68] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#103C39] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save preference"}
        </button>
      </fieldset>

      <div aria-live="polite" aria-atomic="true">
        {state.message && (
          <p
            className={`rounded-lg p-3 text-sm ${
              state.success
                ? "bg-emerald-50 text-emerald-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}