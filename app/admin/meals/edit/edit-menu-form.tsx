"use client";

import { useActionState, useState } from "react";
import {
  updateMealMenu,
  type UpdateMenuState,
} from "@/app/admin/meals/menu-actions";

export type EditableMeal = {
  id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  cutoff_at: string;
};

type EditMenuFormProps = {
  meals: EditableMeal[];
};

const initialState: UpdateMenuState = {
  success: false,
  message: "",
};

function formatMealDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T00:00:00+05:30`));
}

function formatCutoff(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function EditMenuForm({ meals }: EditMenuFormProps) {
  const [selectedMealId, setSelectedMealId] = useState(
    meals[0]?.id ?? ""
  );

  const [menu, setMenu] = useState(meals[0]?.menu ?? "");
  const [showFeedback, setShowFeedback] = useState(false);

  const [state, formAction, pending] = useActionState(
    updateMealMenu,
    initialState
  );

  const selectedMeal = meals.find(
    (meal) => meal.id === selectedMealId
  );

  function handleMealChange(mealId: string) {
    const meal = meals.find((item) => item.id === mealId);

    setSelectedMealId(mealId);
    setMenu(meal?.menu ?? "");
    setShowFeedback(false);
  }

  if (meals.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-[#152D33]">
          No meals available to edit
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Create an upcoming meal with a future cutoff time.
          Meals whose cutoff has passed cannot be edited.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={() => setShowFeedback(true)}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <fieldset disabled={pending} className="min-w-0 space-y-6">
        <div>
          <label
            htmlFor="edit-meal"
            className="block text-sm font-semibold text-[#152D33]"
          >
            Select a meal
          </label>

          <select
            id="edit-meal"
            name="meal_slot_id"
            required
            value={selectedMeal ? selectedMealId : ""}
            onChange={(event) =>
              handleMealChange(event.target.value)
            }
            className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-[#152D33] focus:border-[#087A68] focus:outline-none focus:ring-2 focus:ring-[#087A68]/20"
          >
            <option value="" disabled>
              Select a meal
            </option>

            {meals.map((meal) => (
              <option key={meal.id} value={meal.id}>
                {formatMealDate(meal.meal_date)} · {meal.meal_type}
              </option>
            ))}
          </select>

          {selectedMeal && (
            <p className="mt-2 text-sm text-slate-600">
              Editing closes: {formatCutoff(selectedMeal.cutoff_at)} IST
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="updated-menu"
            className="block text-sm font-semibold text-[#152D33]"
          >
            Updated menu
          </label>

          <textarea
            id="updated-menu"
            name="menu"
            required
            minLength={3}
            maxLength={1000}
            rows={5}
            value={menu}
            disabled={!selectedMeal}
            aria-describedby="menu-help"
            onChange={(event) => {
              setMenu(event.target.value);
              setShowFeedback(false);
            }}
            placeholder="For example: Roti, dal, rice, mixed vegetables and curd"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-[#152D33] focus:border-[#087A68] focus:outline-none focus:ring-2 focus:ring-[#087A68]/20 disabled:bg-slate-100"
          />

          <p id="menu-help" className="mt-2 text-sm text-slate-500">
            {Array.from(menu).length}/1,000 characters.
            Only the menu text will change.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || !selectedMeal}
          className="min-h-12 rounded-xl bg-[#087A68] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving menu…" : "Save menu"}
        </button>
      </fieldset>

      {!pending && showFeedback && state.message && (
        <p
          role={state.success ? "status" : "alert"}
          className={`mt-4 rounded-xl px-4 py-3 text-sm ${
            state.success
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}