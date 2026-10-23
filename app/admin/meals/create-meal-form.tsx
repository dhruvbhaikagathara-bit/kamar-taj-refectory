"use client";

import { useActionState, useState } from "react";
import { createMeal } from "./actions";

const initialState = {
  success: false,
  message: "",
};

const inputClass =
  "mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[#152D33] outline-none focus:border-[#087A68] focus:ring-2 focus:ring-[#087A68]/20";

export function CreateMealForm() {
  const [state, formAction, pending] = useActionState(
    createMeal,
    initialState
  );

  const [values, setValues] = useState({
    meal_date: "",
    meal_type: "LUNCH",
    menu: "",
    price_rupees: "",
    cutoff_at: "",
    serve_start: "",
    serve_end: "",
  });

  function updateValue(name: keyof typeof values, value: string) {
    setValues((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  return (
    <form action={formAction} className="space-y-6">
      <p className="rounded-lg bg-[#EFF5F7] p-4 text-sm text-slate-700">
        Enter all dates and times in Indian Standard Time (IST).
        The cutoff is the deadline for students to change their meal choice.
      </p>

      <fieldset disabled={pending} className="space-y-6">
        <legend className="sr-only">Meal details</legend>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="meal_date" className="text-sm font-semibold">
              Meal date
            </label>

            <input
              id="meal_date"
              name="meal_date"
              type="date"
              required
              value={values.meal_date}
              onChange={(event) =>
                updateValue("meal_date", event.target.value)
              }
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="meal_type" className="text-sm font-semibold">
              Meal type
            </label>

            <select
              id="meal_type"
              name="meal_type"
              required
              value={values.meal_type}
              onChange={(event) =>
                updateValue("meal_type", event.target.value)
              }
              className={inputClass}
            >
              <option value="BREAKFAST">Breakfast</option>
              <option value="LUNCH">Lunch</option>
              <option value="DINNER">Dinner</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="menu" className="text-sm font-semibold">
            Menu
          </label>

          <textarea
            id="menu"
            name="menu"
            required
            minLength={3}
            maxLength={1000}
            rows={3}
            placeholder="Example: Roti, dal, rice, mixed vegetables and curd"
            value={values.menu}
            onChange={(event) =>
              updateValue("menu", event.target.value)
            }
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="price_rupees" className="text-sm font-semibold">
            Price per meal (₹)
          </label>

          <input
            id="price_rupees"
            name="price_rupees"
            type="number"
            required
            min="0"
            max="10000"
            step="0.01"
            placeholder="60"
            value={values.price_rupees}
            onChange={(event) =>
              updateValue("price_rupees", event.target.value)
            }
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="cutoff_at" className="text-sm font-semibold">
            Meal-choice cutoff (IST)
          </label>

          <input
            id="cutoff_at"
            name="cutoff_at"
            type="datetime-local"
            required
            step="60"
            value={values.cutoff_at}
            onChange={(event) =>
              updateValue("cutoff_at", event.target.value)
            }
            className={inputClass}
          />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="serve_start" className="text-sm font-semibold">
              Serving starts (IST)
            </label>

            <input
              id="serve_start"
              name="serve_start"
              type="datetime-local"
              required
              step="60"
              value={values.serve_start}
              onChange={(event) =>
                updateValue("serve_start", event.target.value)
              }
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="serve_end" className="text-sm font-semibold">
              Serving ends (IST)
            </label>

            <input
              id="serve_end"
              name="serve_end"
              type="datetime-local"
              required
              step="60"
              value={values.serve_end}
              onChange={(event) =>
                updateValue("serve_end", event.target.value)
              }
              className={inputClass}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-[#087A68] px-5 py-3 font-semibold text-white hover:bg-[#103C39] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {pending ? "Saving meal..." : "Create meal"}
        </button>
      </fieldset>

      <div aria-live="polite" aria-atomic="true">
        {state.message && (
          <p
            className={`rounded-lg p-4 text-sm font-medium ${
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