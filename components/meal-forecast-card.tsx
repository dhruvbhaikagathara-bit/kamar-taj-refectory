"use client";

import { useState } from "react";

export type MealForecast = {
  meal_slot_id: string;
  meal_type: string;
  expected_count: number;
  historical_meals: number;
  historical_expected: number;
  historical_collected: number;
  collection_rate: number | null;
  predicted_collections: number | null;
  forecast_status:
    | "SERVING_STARTED"
    | "NO_EXPECTED_DINERS"
    | "INSUFFICIENT_HISTORY"
    | "PROVISIONAL"
    | "READY";
};

type MealForecastCardProps = {
  mealLabel: string;
  forecast: MealForecast;
};

const statusMessages: Record<
  MealForecast["forecast_status"],
  string
> = {
  SERVING_STARTED:
    "Serving has started. Review actual collections in the consumption charts.",
  NO_EXPECTED_DINERS:
    "No eligible students are currently opted in. A collection forecast is unavailable.",
  INSUFFICIENT_HISTORY:
    "At least 7 usable past meals of this type are needed before a prediction can be shown.",
  PROVISIONAL:
    "Students can still change their choices. This prediction may change before cutoff.",
  READY:
    "The meal-choice cutoff has passed. The prediction uses current eligible enrollments.",
};

export function MealForecastCard({
  mealLabel,
  forecast,
}: MealForecastCardProps) {
  const [plannedText, setPlannedText] = useState("");

  const canForecast =
    (forecast.forecast_status === "READY" ||
      forecast.forecast_status === "PROVISIONAL") &&
    forecast.predicted_collections !== null &&
    forecast.collection_rate !== null;

  const validPlan =
    /^\d{1,6}$/.test(plannedText) &&
    Number(plannedText) <= 100000;

  const planned = validPlan ? Number(plannedText) : null;

  const predicted = canForecast
    ? forecast.predicted_collections
    : null;

  const excess =
    planned !== null && predicted !== null
      ? Math.max(0, planned - predicted)
      : null;

  const shortfall =
    planned !== null && predicted !== null
      ? Math.max(0, predicted - planned)
      : null;

  const inputId = `planned-portions-${forecast.meal_slot_id}`;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-[#103C39]">
          {mealLabel} forecast
        </h3>

        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
          Historical estimate
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600">
        {statusMessages[forecast.forecast_status]}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-xs text-slate-600">
            Currently expected
          </dt>
          <dd className="mt-1 text-2xl font-bold text-[#103C39]">
            {forecast.expected_count}
          </dd>
        </div>

        <div className="rounded-xl bg-blue-50 p-4">
          <dt className="text-xs text-blue-800">
            Predicted collections
          </dt>
          <dd className="mt-1 text-2xl font-bold text-blue-900">
            {predicted ?? "—"}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-slate-600">
        Historical sample: {forecast.historical_meals} meals.
        {forecast.collection_rate !== null && (
          <>
            {" "}
            Collection rate:{" "}
            {(forecast.collection_rate * 100).toFixed(1)}%.
          </>
        )}
      </p>

      {canForecast ? (
        <>
          <div className="mt-5">
            <label
              htmlFor={inputId}
              className="text-sm font-semibold text-[#152D33]"
            >
              Planned preparation — portions
            </label>

            <input
              id={inputId}
              type="number"
              min="0"
              max="100000"
              step="1"
              inputMode="numeric"
              value={plannedText}
              onChange={(event) =>
                setPlannedText(event.target.value)
              }
              placeholder="Enter your kitchen's preparation plan"
              aria-describedby={`${inputId}-help`}
              aria-invalid={
                plannedText !== "" && !validPlan
                  ? true
                  : undefined
              }
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-[#087A68] focus:ring-2 focus:ring-[#087A68]/20"
            />

            <p
              id={`${inputId}-help`}
              className="mt-2 text-xs leading-5 text-slate-500"
            >
              Try different preparation quantities.
              This input is a planning calculator and is
              not saved to the database.
            </p>
          </div>

          <div
            aria-live="polite"
            aria-atomic="true"
            className="mt-4"
          >
            {plannedText !== "" && !validPlan ? (
              <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
                Enter a whole number between 0 and 100,000.
              </p>
            ) : excess !== null && shortfall !== null ? (
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-amber-50 p-4">
                    <dt className="text-xs text-amber-900">
                      Predicted excess
                    </dt>
                    <dd className="mt-1 text-2xl font-bold text-amber-950">
                      {excess}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-rose-50 p-4">
                    <dt className="text-xs text-rose-900">
                      Predicted shortfall
                    </dt>
                    <dd className="mt-1 text-2xl font-bold text-rose-950">
                      {shortfall}
                    </dd>
                  </div>
                </dl>

                <p className="text-sm leading-6 text-slate-700">
                  {shortfall > 0
                    ? `Your plan is ${shortfall} portions below predicted collections.`
                    : excess > 0
                      ? `Your plan is ${excess} portions above predicted collections.`
                      : "Your plan matches the predicted collection count."}
                  {" "}
                  Actual demand may differ; review kitchen
                  requirements before changing preparation.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Enter planned portions to calculate the
                estimated excess or shortfall.
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          {forecast.forecast_status === "INSUFFICIENT_HISTORY"
            ? `${Math.max(
                0,
                7 - forecast.historical_meals
              )} more usable historical meals are needed.`
            : "Preparation estimates are unavailable for this meal."}
        </p>
      )}

      <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
        Uses up to 28 recent meals of the same type from the
        previous 90 days. Eligible history requires a kitchen
        waste report and at least 24 hours since serving ended.
        Historical enrollment counts can change when accounts
        change. This estimate is not machine learning or a
        guarantee of demand.
      </p>

      <p className="mt-2 text-xs leading-5 text-slate-500">
        Predicted excess is not measured discarded food.
        Only kitchen-confirmed surplus should create a
        redistribution alert.
      </p>
    </article>
  );
}