"use client";

import { useActionState, useEffect, useState } from "react";
import { createMeal } from "./actions";

const initialState = {
  success: false,
  message: "",
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const inputClass =
  "mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[#152D33] outline-none focus:border-[#087A68] focus:ring-2 focus:ring-[#087A68]/20";

function toISTInput(milliseconds: number): string {
  return new Date(milliseconds + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 16);
}

function addOneMinute(value: string): string {
  if (!value) return "";

  const milliseconds = Date.parse(`${value}:00+05:30`);

  if (!Number.isFinite(milliseconds)) return "";

  return toISTInput(milliseconds + MINUTE_MS);
}

function latestValue(...values: string[]): string {
  return values.reduce(
    (latest, value) => (value > latest ? value : latest),
    ""
  );
}

export function CreateMealForm() {
  const [state, formAction, pending] = useActionState(
    createMeal,
    initialState
  );

  // Start empty so server and browser initially render alike.
  const [clock, setClock] = useState<{
    today: string;
    nextMinute: string;
  } | null>(null);

  const [values, setValues] = useState({
    meal_date: "",
    meal_type: "LUNCH",
    menu: "",
    price_rupees: "",
    cutoff_at: "",
    serve_start: "",
    serve_end: "",
  });

  useEffect(() => {
    function updateClock() {
      const now = Date.now();

      // Inputs use whole minutes. The next whole minute
      // is the earliest selectable time strictly after now.
      const nextMinute =
        (Math.floor(now / MINUTE_MS) + 1) * MINUTE_MS;

      const today = toISTInput(now).slice(0, 10);
      const nextMinuteText = toISTInput(nextMinute);

      setClock((previous) =>
        previous?.today === today &&
        previous.nextMinute === nextMinuteText
          ? previous
          : { today, nextMinute: nextMinuteText }
      );
    }

    const initialTimer = window.setTimeout(updateClock, 0);
    const interval = window.setInterval(updateClock, 1000);

    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateClock);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", updateClock);
      document.removeEventListener(
        "visibilitychange",
        updateClock
      );
    };
  }, []);

  function updateValue(
    name: keyof typeof values,
    value: string
  ) {
    setValues((previous) => {
      if (name === "meal_date") {
        // Times belong to the selected meal date.
        return {
          ...previous,
          meal_date: value,
          cutoff_at: "",
          serve_start: "",
          serve_end: "",
        };
      }

      return {
        ...previous,
        [name]: value,
      };
    });
  }

  const earliestTime = clock?.nextMinute ?? "";

  const selectedDayStart = values.meal_date
    ? `${values.meal_date}T00:00`
    : "";

  const selectedDayEnd = values.meal_date
    ? `${values.meal_date}T23:59`
    : "";

  const startMinimum = latestValue(
    earliestTime,
    selectedDayStart,
    values.cutoff_at
  );

  const endMinimum = latestValue(
    earliestTime,
    addOneMinute(values.serve_start)
  );

  const cutoffMaximum =
    values.serve_start || selectedDayEnd;

  const dateIsPast =
    clock !== null &&
    values.meal_date !== "" &&
    values.meal_date < clock.today;

  const selectedDayHasNoTime =
    selectedDayEnd !== "" &&
    earliestTime !== "" &&
    earliestTime > selectedDayEnd;

  return (
    <form action={formAction} className="space-y-6">
      <div className="rounded-lg bg-[#EFF5F7] p-4 text-sm leading-6 text-slate-700">
        <p>
          Enter all dates and times in Indian Standard Time
          (IST). Past meal dates are not allowed.
        </p>

        <p className="mt-2">
          Cutoff must be after the current time. Serving
          must start on the selected meal date, at or after
          cutoff, and end after serving starts.
        </p>

        {clock && (
          <p className="mt-2 font-semibold">
            Earliest future time:{" "}
            {clock.nextMinute.replace("T", " ")} IST
          </p>
        )}
      </div>

      {(dateIsPast || selectedDayHasNoTime) && (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900"
        >
          {dateIsPast
            ? "The selected meal date is now in the past. Choose today or a future date."
            : "No future whole-minute serving time remains on this date. Choose a later meal date."}
        </p>
      )}

      <fieldset
        disabled={pending || clock === null}
        className="space-y-6"
      >
        <legend className="sr-only">Meal details</legend>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label
              htmlFor="meal_date"
              className="text-sm font-semibold"
            >
              Meal date
            </label>

            <input
              id="meal_date"
              name="meal_date"
              type="date"
              required
              min={clock?.today}
              max="9999-12-31"
              value={values.meal_date}
              onChange={(event) =>
                updateValue("meal_date", event.target.value)
              }
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="meal_type"
              className="text-sm font-semibold"
            >
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
          <label
            htmlFor="menu"
            className="text-sm font-semibold"
          >
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
          <label
            htmlFor="price_rupees"
            className="text-sm font-semibold"
          >
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
          <label
            htmlFor="cutoff_at"
            className="text-sm font-semibold"
          >
            Meal-choice cutoff (IST)
          </label>

          <input
            id="cutoff_at"
            name="cutoff_at"
            type="datetime-local"
            required
            step="60"
            min={earliestTime || undefined}
            max={cutoffMaximum || undefined}
            disabled={!values.meal_date}
            value={values.cutoff_at}
            onChange={(event) =>
              updateValue("cutoff_at", event.target.value)
            }
            className={inputClass}
          />

          <p className="mt-2 text-xs text-slate-500">
            For a future meal, cutoff may be on an earlier
            date, but it must still be in the future.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label
              htmlFor="serve_start"
              className="text-sm font-semibold"
            >
              Serving starts (IST)
            </label>

            <input
              id="serve_start"
              name="serve_start"
              type="datetime-local"
              required
              step="60"
              min={startMinimum || undefined}
              max={selectedDayEnd || undefined}
              disabled={!values.meal_date}
              value={values.serve_start}
              onChange={(event) =>
                updateValue("serve_start", event.target.value)
              }
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor="serve_end"
              className="text-sm font-semibold"
            >
              Serving ends (IST)
            </label>

            <input
              id="serve_end"
              name="serve_end"
              type="datetime-local"
              required
              step="60"
              min={endMinimum || undefined}
              max="9999-12-31T23:59"
              disabled={!values.serve_start}
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
          disabled={
            pending ||
            clock === null ||
            dateIsPast ||
            selectedDayHasNoTime
          }
          className="w-full rounded-lg bg-[#087A68] px-5 py-3 font-semibold text-white hover:bg-[#103C39] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {pending
            ? "Saving meal…"
            : clock === null
              ? "Loading date limits…"
              : "Create meal"}
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