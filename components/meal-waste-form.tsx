"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveMealWasteReport } from "@/app/admin/analytics/waste-actions";
import type { MealWasteReport } from "@/lib/meal-waste-types";

type MealWasteFormProps = {
  mealId: string;
  mealLabel: string;
  canRecord: boolean;
  report: MealWasteReport | null;
};

const inputClass =
  "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#087A68] disabled:bg-slate-100";

export function MealWasteForm({
  mealId,
  mealLabel,
  canRecord,
  report,
}: MealWasteFormProps) {
  const router = useRouter();

  const busyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);

  const [version, setVersion] = useState(
    report?.version ?? 0
  );

  const [values, setValues] = useState({
    preparedPortions:
      report ? String(report.prepared_portions) : "",
    leftoverPortions:
      report ? String(report.leftover_portions) : "",
    wasteKg:
      report ? String(report.waste_grams / 1000) : "",
    notes: report?.notes ?? "",
  });

  const [notice, setNotice] = useState<{
    error: boolean;
    text: string;
  } | null>(null);

  function update(
    field: keyof typeof values,
    value: string
  ) {
    setValues((previous) => ({
      ...previous,
      [field]: value,
    }));

    setNotice(null);
  }

  async function submit() {
    if (
      busyRef.current ||
      !canRecord ||
      conflict
    ) {
      return;
    }

    busyRef.current = true;
    setPending(true);
    setNotice(null);

    try {
      const result = await saveMealWasteReport({
        mealId,
        ...values,
        expectedVersion: version,
      });

      if (!result.success) {
        if (result.code === "WASTE_REPORT_CHANGED") {
          setConflict(true);
        }

        setNotice({
          error: true,
          text: result.message,
        });

        return;
      }

      const saved = result.report;

      setVersion(saved.version);

      setValues({
        preparedPortions: String(saved.prepared_portions),
        leftoverPortions: String(saved.leftover_portions),
        wasteKg: String(saved.waste_grams / 1000),
        notes: saved.notes,
      });

      setNotice({
        error: false,
        text: result.message,
      });

      router.refresh();
    } catch {
      setNotice({
        error: true,
        text:
          "The save could not be confirmed. Check your connection, then reload the page to check the report before retrying.",
      });
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }

  const preparedNumber = Number(values.preparedPortions);

  const leftoverMaximum =
    values.preparedPortions.trim() !== "" &&
    Number.isInteger(preparedNumber) &&
    preparedNumber >= 0 &&
    preparedNumber <= 100000
      ? preparedNumber
      : 100000;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-[#103C39]">
          {mealLabel} — waste report
        </h3>

        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            version > 0
              ? "bg-emerald-50 text-emerald-800"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {version > 0
            ? `Recorded · revision ${version}`
            : "Not recorded"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600">
        Enter actual kitchen measurements. Leftover
        portions are food remaining unserved when serving
        ends. Discarded weight includes food thrown away,
        including plate waste, counted once.
      </p>

      {!canRecord && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
        >
          Final measurements can be saved after serving
          ends. Refresh this page once serving is over.
        </p>
      )}

      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset
          disabled={pending || !canRecord || conflict}
          className="space-y-5"
        >
          <legend className="sr-only">
            Waste measurements for {mealLabel}
          </legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <label
              htmlFor={`prepared-${mealId}`}
              className="block text-sm font-semibold"
            >
              Prepared portions

              <input
                id={`prepared-${mealId}`}
                name="preparedPortions"
                type="number"
                min={0}
                max={100000}
                step={1}
                required
                value={values.preparedPortions}
                onChange={(event) =>
                  update(
                    "preparedPortions",
                    event.target.value
                  )
                }
                placeholder="Example: 100"
                className={inputClass}
              />
            </label>

            <label
              htmlFor={`leftover-${mealId}`}
              className="block text-sm font-semibold"
            >
              Leftover portions

              <input
                id={`leftover-${mealId}`}
                name="leftoverPortions"
                type="number"
                min={0}
                max={leftoverMaximum}
                step={1}
                required
                value={values.leftoverPortions}
                onChange={(event) =>
                  update(
                    "leftoverPortions",
                    event.target.value
                  )
                }
                placeholder="Example: 12"
                className={inputClass}
              />
            </label>

            <label
              htmlFor={`waste-${mealId}`}
              className="block text-sm font-semibold"
            >
              Discarded food (kg)

              <input
                id={`waste-${mealId}`}
                name="wasteKg"
                type="number"
                min={0}
                max={100000}
                step="0.001"
                required
                value={values.wasteKg}
                onChange={(event) =>
                  update("wasteKg", event.target.value)
                }
                placeholder="Example: 2.500"
                aria-describedby={`weight-help-${mealId}`}
                className={inputClass}
              />
            </label>
          </div>

          <p
            id={`weight-help-${mealId}`}
            className="text-xs leading-5 text-slate-500"
          >
            Weigh discarded food without its container.
            Use up to three decimal places: 0.250 kg =
            250 grams. Enter 0 only if you measured no
            waste; leave an unmeasured report unsaved.
          </p>

          <label
            htmlFor={`notes-${mealId}`}
            className="block text-sm font-semibold"
          >
            Notes — optional

            <textarea
              id={`notes-${mealId}`}
              name="notes"
              rows={3}
              maxLength={1000}
              value={values.notes}
              onChange={(event) =>
                update("notes", event.target.value)
              }
              placeholder="Example: Eight leftover portions were donated. Discarded weight includes plate waste."
              className={inputClass}
            />
          </label>

          <p className="text-xs leading-5 text-slate-500">
            Leftovers reused or donated are not discarded
            food. These measurements do not change student
            charges or rebates.
          </p>

          <button
            type="submit"
            disabled={pending || !canRecord || conflict}
            className="min-h-11 rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? "Saving…"
              : version > 0
                ? "Update waste report"
                : "Save waste report"}
          </button>
        </fieldset>

        <div aria-live="polite" aria-atomic="true">
          {notice && (
            <p
              className={`mt-4 rounded-xl p-4 text-sm leading-6 ${
                notice.error
                  ? "bg-red-50 text-red-800"
                  : "bg-emerald-50 text-emerald-800"
              }`}
            >
              {notice.text}
            </p>
          )}
        </div>

        {conflict && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reload latest report
          </button>
        )}
      </form>
    </section>
  );
}