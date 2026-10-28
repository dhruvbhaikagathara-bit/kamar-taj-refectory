"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previewPlan, savePlan, stopPlan } from "./actions";
import type {
  MealType,
  PlanHistory,
  PlanInput,
  PlanPreview,
} from "./types";

const mealTypes: MealType[] = ["BREAKFAST", "LUNCH", "DINNER"];

const names: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
};

const inputClass =
  "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[#152D33] focus:outline-none focus:ring-2 focus:ring-[#087A68]";

const buttonClass =
  "min-h-11 rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);

  if (!Number.isFinite(parsed.getTime())) return "";

  parsed.setUTCDate(parsed.getUTCDate() + days);

  return parsed.toISOString().slice(0, 10);
}

function dayCount(start: string, end: string) {
  if (!start || !end) return 0;

  const days =
    (Date.parse(`${end}T00:00:00Z`) -
      Date.parse(`${start}T00:00:00Z`)) /
      86400000 +
    1;

  return Number.isFinite(days) ? days : 0;
}

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T00:00:00+05:30`));
}

type MealPlannerProps = {
  today: string;
  history: PlanHistory[];
};

export function MealPlanner({
  today,
  history,
}: MealPlannerProps) {
  const router = useRouter();

  const [form, setForm] = useState<PlanInput>({
    startDate: today,
    endDate: addDays(today, 9),
    status: "OPTED_OUT",
    mealTypes: [...mealTypes],
  });

  const [review, setReview] = useState<{
    input: PlanInput;
    preview: PlanPreview;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [notice, setNotice] = useState<{
    error: boolean;
    text: string;
  } | null>(null);

  const duration = dayCount(form.startDate, form.endDate);

  function change(values: Partial<PlanInput>) {
    setForm((previous) => ({
      ...previous,
      ...values,
    }));

    setReview(null);
    setNotice(null);
  }

  function beginWork() {
    if (busyRef.current) return false;

    busyRef.current = true;
    setBusy(true);
    setNotice(null);

    return true;
  }

  function endWork() {
    busyRef.current = false;
    setBusy(false);
  }

  async function loadPreview() {
    if (!beginWork()) return;

    setReview(null);

    try {
      const result = await previewPlan(form);

      if (!result.success) {
        setNotice({
          error: true,
          text: result.message,
        });
      } else {
        setReview({
          input: {
            ...form,
            mealTypes: [...form.mealTypes],
          },
          preview: result.data,
        });
      }
    } catch {
      setNotice({
        error: true,
        text: "Could not load the preview. Check your connection and try again.",
      });
    } finally {
      endWork();
    }
  }

  async function apply() {
    if (!review || !beginWork()) return;

    try {
      const result = await savePlan(
        review.input,
        review.preview.request_id
      );

      if (!result.success) {
        setNotice({
          error: true,
          text: result.message,
        });
      } else {
        const data = result.data;

        setNotice({
          error: false,
          text: `${
            data.replayed
              ? "Previously saved plan confirmed"
              : "Plan saved"
          }: ${data.updated} meals updated, ${
            data.unchanged
          } unchanged, ${data.locked} locked. ${
            data.unpublished
          } unpublished date/meal slots covered for later creation.`,
        });

        setReview(null);
        router.refresh();
      }
    } catch {
      // Preserve the request ID so retrying does not reapply the plan.
      setNotice({
        error: true,
        text: "The result could not be confirmed. Retry Apply to check the same request, or refresh and check history before creating a different plan.",
      });
    } finally {
      endWork();
    }
  }

  async function stop(planId: string) {
    if (busyRef.current) return;

    const confirmed = window.confirm(
      "Stop this plan from applying to newly created meals? Existing choices and billing will stay as they are. Use a new opt-in plan to return early."
    );

    if (!confirmed || !beginWork()) return;

    try {
      const result = await stopPlan(planId);

      if (!result.success) {
        setNotice({
          error: true,
          text: result.message,
        });
      } else {
        setNotice({
          error: false,
          text: "Automatic coverage stopped. Existing meal choices and billing were not changed.",
        });

        setReview(null);
        router.refresh();
      }
    } catch {
      setNotice({
        error: true,
        text: "Could not confirm the change. Refresh and check plan history.",
      });
    } finally {
      endWork();
    }
  }

  function returnEarly(
    plan: PlanHistory,
    returnDate: string
  ) {
    if (busyRef.current) return;

    change({
      startDate: returnDate,
      endDate: plan.end_date,
      status: "OPTED_IN",
      mealTypes: [...plan.meal_types],
    });

    setNotice({
      error: false,
      text: "Return dates filled in. Review the opt-in plan and billing impact before applying it.",
    });

    formRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    formRef.current
      ?.querySelector<HTMLInputElement>("#plan-start")
      ?.focus({ preventScroll: true });
  }

  return (
    <div className="space-y-7">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-sm leading-6 text-[#103C39]">
        Both dates are included. Each meal keeps its own
        deadline. Unpublished meals follow your saved plan
        when created, while the cutoff is still open. You
        can change any individual meal before its deadline
        afterward.
      </div>

      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void loadPreview();
        }}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <fieldset disabled={busy} className="space-y-5">
          <legend className="text-xl font-bold">
            Create a meal plan
          </legend>

          <button
            type="button"
            onClick={() =>
              change({
                status: "OPTED_OUT",
                mealTypes: [...mealTypes],
              })
            }
            className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-[#087A68] focus-visible:outline focus-visible:outline-2"
          >
            Going home? Skip all meals
          </button>

          <div className="grid gap-4 lg:grid-cols-3">
            <label
              htmlFor="plan-start"
              className="text-sm font-semibold"
            >
              Start date (IST)

              <input
                id="plan-start"
                type="date"
                required
                min={today}
                max={addDays(today, 365)}
                value={form.startDate}
                onChange={(event) =>
                  change({
                    startDate: event.target.value,
                    endDate: addDays(
                      event.target.value,
                      Math.min(
                        90,
                        Math.max(1, duration)
                      ) - 1
                    ),
                  })
                }
                className={inputClass}
              />
            </label>

            <label
              htmlFor="plan-days"
              className="text-sm font-semibold"
            >
              Number of days

              <input
                id="plan-days"
                type="number"
                required
                min={1}
                max={90}
                step={1}
                value={duration > 0 ? duration : ""}
                onChange={(event) => {
                  const days = Number(event.target.value);

                  change({
                    endDate:
                      Number.isInteger(days) &&
                      days >= 1 &&
                      days <= 90
                        ? addDays(form.startDate, days - 1)
                        : "",
                  });
                }}
                className={inputClass}
              />
            </label>

            <label
              htmlFor="plan-end"
              className="text-sm font-semibold"
            >
              End date (included)

              <input
                id="plan-end"
                type="date"
                required
                min={form.startDate || today}
                max={addDays(today, 365)}
                value={form.endDate}
                onChange={(event) =>
                  change({
                    endDate: event.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
          </div>

          <p className="text-xs text-slate-500">
            Up to 90 days per plan, ending within the next
            365 days. All meal deadlines use IST.
          </p>

          <fieldset>
            <legend className="text-sm font-semibold">
              Which meals?
            </legend>

            <div className="mt-3 flex flex-wrap gap-3">
              {mealTypes.map((type) => (
                <label
                  key={type}
                  className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={form.mealTypes.includes(type)}
                    onChange={(event) =>
                      change({
                        mealTypes: mealTypes.filter(
                          (meal) =>
                            meal === type
                              ? event.target.checked
                              : form.mealTypes.includes(meal)
                        ),
                      })
                    }
                    className="h-4 w-4 accent-emerald-700"
                  />

                  {names[type]}
                </label>
              ))}
            </div>
          </fieldset>

          <label
            htmlFor="plan-status"
            className="block text-sm font-semibold"
          >
            Apply this choice

            <select
              id="plan-status"
              value={form.status}
              onChange={(event) =>
                change({
                  status:
                    event.target.value === "OPTED_IN"
                      ? "OPTED_IN"
                      : "OPTED_OUT",
                })
              }
              className={inputClass}
            >
              <option value="OPTED_OUT">
                Opt out — I will skip these meals
              </option>
              <option value="OPTED_IN">
                Opt in — I will eat these meals
              </option>
            </select>
          </label>

          <button
            type="submit"
            disabled={
              busy ||
              form.mealTypes.length === 0 ||
              duration < 1 ||
              duration > 90
            }
            className={buttonClass}
          >
            {busy ? "Working…" : "Review changes"}
          </button>
        </fieldset>
      </form>

      {notice && (
        <p
          role={notice.error ? "alert" : "status"}
          className={`rounded-xl p-5 text-sm leading-6 ${
            notice.error
              ? "bg-red-50 text-red-800"
              : "bg-emerald-50 text-emerald-900"
          }`}
        >
          {notice.text}
        </p>
      )}

      {review && (
        <section
          aria-labelledby="plan-review"
          className="rounded-2xl border-2 border-[#087A68] bg-white p-5 sm:p-6"
        >
          <h2
            id="plan-review"
            className="text-xl font-bold"
          >
            Review before applying
          </h2>

          <p className="mt-2 text-sm text-slate-600">
            {dateLabel(review.input.startDate)} –{" "}
            {dateLabel(review.input.endDate)} ·{" "}
            {review.input.status === "OPTED_OUT"
              ? "Opt out"
              : "Opt in"}{" "}
            ·{" "}
            {review.input.mealTypes
              .map((type) => names[type])
              .join(", ")}
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Meals to update", review.preview.updates],
              ["Already selected", review.preview.unchanged],
              ["Locked meals", review.preview.locked],
              ["Unpublished slots", review.preview.unpublished],
            ].map(([label, count]) => (
              <div
                key={String(label)}
                className="rounded-xl bg-slate-50 p-4"
              >
                <dt className="text-xs text-slate-600">
                  {label}
                </dt>
                <dd className="mt-2 text-2xl font-bold">
                  {count}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 rounded-xl bg-[#EFF5F7] p-4 text-sm leading-6">
            <p className="font-semibold">
              Estimated billing changes for published meals
            </p>

            <p>
              New charges:{" "}
              {money(review.preview.new_charges_paise)}
            </p>

            <p>
              Cancellation credits:{" "}
              {money(review.preview.credits_paise)}
            </p>

            <p>
              Credits reversed on rejoining:{" "}
              {money(review.preview.reversals_paise)}
            </p>

            <p className="mt-2 text-xs text-slate-600">
              No amount is estimated for unpublished meals.
              A first-time opt-out creates no charge or
              credit. Final results are recalculated when
              you apply; a cutoff may pass after this
              preview.
            </p>
          </div>

          {review.preview.overlap_slots > 0 && (
            <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              This replaces saved preferences for{" "}
              {review.preview.overlap_slots} overlapping
              date/meal slots. Earlier plans still apply
              outside this selection.
            </p>
          )}

          <p className="mt-4 text-sm text-slate-600">
            Applying explicitly replaces eligible existing
            choices in this selection, including earlier
            manual choices. Later individual changes will
            stay in place. Locked meals are skipped.
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className={`mt-5 ${buttonClass}`}
          >
            {busy ? "Applying…" : "Apply meal plan"}
          </button>
        </section>
      )}

      <section aria-labelledby="plan-history">
        <h2
          id="plan-history"
          className="text-2xl font-bold"
        >
          Your plan history
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Latest 50 plans. Assigned slots include published
          and unpublished meals from today onward. Stopping
          coverage does not undo existing choices.
        </p>

        {history.length === 0 ? (
          <p className="mt-5 rounded-xl bg-white p-6 text-slate-600">
            No meal plans yet.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {history.map((plan) => (
              <article
                key={plan.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-bold">
                    {dateLabel(plan.start_date)} –{" "}
                    {dateLabel(plan.end_date)}
                  </h3>

                  <span className="rounded-full bg-[#EFF5F7] px-3 py-1 text-xs font-semibold">
                    {plan.stopped_at
                      ? "Coverage stopped"
                      : plan.scheduled_slots > 0
                        ? "Coverage assigned"
                        : "Ended or replaced"}
                  </span>
                </div>

                <p className="mt-2 text-sm">
                  {plan.desired_status === "OPTED_OUT"
                    ? "Skipping"
                    : "Eating"}
                  :{" "}
                  {plan.meal_types
                    .map((type) => names[type])
                    .join(", ")}
                </p>

                <p className="mt-3 text-sm text-slate-600">
                  Initially:{" "}
                  {plan.initial_result.updated ?? 0} updated
                  {" · "}
                  {plan.initial_result.locked ?? 0} locked.
                  Later publications: {plan.future_updated}{" "}
                  updated{" · "}
                  {plan.future_locked} locked.
                </p>

                <p className="mt-2 text-xs text-slate-500">
                  {plan.scheduled_slots} date/meal slots
                  currently assigned from today onward.
                </p>

                {plan.end_date >= today &&
                  plan.desired_status === "OPTED_OUT" && (
                    <form
                      className="mt-4 flex flex-wrap items-end gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();

                        const date = new FormData(
                          event.currentTarget
                        ).get("returnDate");

                        if (typeof date === "string") {
                          returnEarly(plan, date);
                        }
                      }}
                    >
                      <label className="text-sm font-medium">
                        Return date (IST)

                        <input
                          aria-label={`Return date for plan starting ${plan.start_date}`}
                          name="returnDate"
                          type="date"
                          required
                          min={
                            today > plan.start_date
                              ? today
                              : plan.start_date
                          }
                          max={plan.end_date}
                          defaultValue={
                            today > plan.start_date
                              ? today
                              : plan.start_date
                          }
                          disabled={busy}
                          className={inputClass}
                        />
                      </label>

                      <button
                        type="submit"
                        disabled={busy}
                        className={buttonClass}
                      >
                        Prepare return early
                      </button>
                    </form>
                  )}

                {!plan.stopped_at &&
                  plan.scheduled_slots > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void stop(plan.id)}
                      className="mt-4 min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
                    >
                      Stop automatic coverage
                    </button>
                  )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}