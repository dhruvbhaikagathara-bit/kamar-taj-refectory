"use client";

import { useActionState, useState } from "react";
import { saveMealSurplus } from "@/app/admin/analytics/surplus-actions";
import {
  isMealSurplusStatus,
  isSurplusClosed,
  isSurplusExpired,
  SURPLUS_STATUS_LABELS,
  type MealSurplusActionState,
  type MealSurplusReport,
  type MealSurplusStatus,
} from "@/lib/meal-surplus-types";

type MealSurplusFormProps = {
  mealId: string;
  mealLabel: string;
  canReport: boolean;
  nowMilliseconds: number;
  report: MealSurplusReport | null;
};

const initialState: MealSurplusActionState = {
  success: false,
  message: "",
};

const inputClass =
  "mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-[#087A68] focus:ring-2 focus:ring-[#087A68]/20 read-only:bg-slate-100";

function toISTInput(value: string): string {
  const milliseconds = Date.parse(value);

  if (!Number.isFinite(milliseconds)) return "";

  return new Date(milliseconds + 330 * 60 * 1000)
    .toISOString()
    .slice(0, 19);
}

function displayIST(value: string): string {
  const local = toISTInput(value);

  if (!local) return "Invalid date";

  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-");

  return `${day}/${month}/${year}, ${time.slice(0, 5)} IST`;
}

function availableStatuses(
  report: MealSurplusReport | null,
  expired: boolean
): MealSurplusStatus[] {
  if (!report) return ["AVAILABLE"];

  if (expired) {
    return ["DISCARDED", "CANCELLED"];
  }

  if (report.status === "ASSIGNED") {
    return [
      "ASSIGNED",
      "COLLECTED",
      "AVAILABLE",
      "DISCARDED",
      "CANCELLED",
    ];
  }

  return [
    "AVAILABLE",
    "ASSIGNED",
    "DISCARDED",
    "CANCELLED",
  ];
}

export function MealSurplusForm(
  props: MealSurplusFormProps
) {
  const { mealLabel, canReport, report } = props;

  if (report && isSurplusClosed(report.status)) {
    return (
      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-[#103C39]">
            {mealLabel} surplus
          </h3>

          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {SURPLUS_STATUS_LABELS[report.status]}
          </span>
        </div>

        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Batch size</dt>
            <dd className="mt-1 font-semibold">
              {report.portions} portions
            </dd>
          </div>

          <div>
            <dt className="text-slate-500">
              Collection deadline
            </dt>
            <dd className="mt-1 font-semibold">
              {displayIST(report.collect_by)}
            </dd>
          </div>

          {report.recipient && (
            <div>
              <dt className="text-slate-500">Recipient</dt>
              <dd className="mt-1 break-words font-semibold">
                {report.recipient}
              </dd>
            </div>
          )}
        </dl>

        {report.notes && (
          <p className="mt-4 whitespace-pre-wrap break-words text-sm text-slate-600">
            {report.notes}
          </p>
        )}

        <p className="mt-4 text-xs text-slate-500">
          This batch is closed. Its saved history is retained.
          Discarded food weight must be recorded separately
          in the waste report.
        </p>
      </article>
    );
  }

  if (!canReport) {
    return (
      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="font-bold text-[#103C39]">
          {mealLabel} surplus
        </h3>

        <p className="mt-2 text-sm text-slate-600">
          Surplus reporting opens when serving begins.
        </p>
      </article>
    );
  }

  return (
    <EditableSurplusForm
      key={`${props.mealId}-${report?.version ?? 0}`}
      {...props}
    />
  );
}

function EditableSurplusForm({
  mealId,
  mealLabel,
  nowMilliseconds,
  report,
}: MealSurplusFormProps) {
  const [state, formAction, pending] = useActionState(
    saveMealSurplus.bind(null, mealId),
    initialState
  );

  const [selectedStatus, setSelectedStatus] =
    useState<MealSurplusStatus>(
      report?.status ?? "AVAILABLE"
    );

  const expired = report
    ? isSurplusExpired(report, nowMilliseconds)
    : false;

  // If a refresh reveals expiry, require a closure action.
  const status: MealSurplusStatus =
    expired &&
    selectedStatus !== "DISCARDED" &&
    selectedStatus !== "CANCELLED"
      ? "DISCARDED"
      : selectedStatus;

  const options = availableStatuses(report, expired);

  const detailsLocked =
    report !== null &&
    (report.status !== "AVAILABLE" ||
      status !== "AVAILABLE");

  const recipientRequired =
    status === "ASSIGNED" || status === "COLLECTED";

  const closureReasonRequired =
    status === "DISCARDED" || status === "CANCELLED";

  const prefix = `surplus-${mealId}`;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-[#103C39]">
          {mealLabel} surplus
        </h3>

        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
          {expired
            ? "Deadline passed"
            : report
              ? SURPLUS_STATUS_LABELS[report.status]
              : "Not reported"}
        </span>
      </div>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Report portions the kitchen has confirmed are available
        for redistribution. This is separate from student meal
        collections and measured waste.
      </p>

      {expired && (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          This batch is no longer available for collection.
          Close it as Discarded, or Cancelled if the report
          was entered in error. Explain the outcome in Notes.
        </p>
      )}

      <form action={formAction} className="mt-5 space-y-5">
        <input
          type="hidden"
          name="expected_version"
          value={report?.version ?? 0}
        />

        <fieldset disabled={pending} className="space-y-5">
          <legend className="sr-only">
            {mealLabel} surplus details
          </legend>

          <div>
            <label
              htmlFor={`${prefix}-status`}
              className="text-sm font-semibold"
            >
              Status
            </label>

            <select
              id={`${prefix}-status`}
              name="status"
              value={status}
              onChange={(event) => {
                const value = event.target.value;

                if (isMealSurplusStatus(value)) {
                  setSelectedStatus(value);
                }
              }}
              className={inputClass}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {SURPLUS_STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${prefix}-portions`}
                className="text-sm font-semibold"
              >
                Portions in this batch
              </label>

              <input
                key={`portions-${detailsLocked}`}
                id={`${prefix}-portions`}
                name="portions"
                type="number"
                min="1"
                max="100000"
                step="1"
                required
                readOnly={detailsLocked}
                defaultValue={report?.portions ?? ""}
                placeholder="Example: 12"
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor={`${prefix}-deadline`}
                className="text-sm font-semibold"
              >
                Collect by — IST
              </label>

              <input
                key={`deadline-${detailsLocked}`}
                id={`${prefix}-deadline`}
                name="collect_by"
                type="datetime-local"
                step="1"
                required
                readOnly={detailsLocked}
                defaultValue={
                  report ? toISTInput(report.collect_by) : ""
                }
                className={inputClass}
              />
            </div>
          </div>

          <p className="text-xs leading-5 text-slate-500">
            Enter the deadline approved by the kitchen.
            The app does not assess food safety.
            Save quantity or deadline edits while the status
            remains Available, before changing its status.
          </p>

          {recipientRequired ? (
            <div>
              <label
                htmlFor={`${prefix}-recipient`}
                className="text-sm font-semibold"
              >
                Recipient or organisation
              </label>

              <input
                key={`recipient-${status}`}
                id={`${prefix}-recipient`}
                name="recipient"
                type="text"
                required
                maxLength={200}
                readOnly={status === "COLLECTED"}
                defaultValue={report?.recipient ?? ""}
                placeholder="Name of the receiving group"
                className={inputClass}
              />

              {status === "COLLECTED" && (
                <p className="mt-2 text-xs text-slate-500">
                  Confirm collection only after the assigned
                  recipient has received the entire batch.
                </p>
              )}
            </div>
          ) : (
            <input
              type="hidden"
              name="recipient"
              value={
                status === "AVAILABLE"
                  ? ""
                  : report?.recipient ?? ""
              }
            />
          )}

          <div>
            <label
              htmlFor={`${prefix}-notes`}
              className="text-sm font-semibold"
            >
              Notes
              {closureReasonRequired
                ? " — reason required"
                : " — optional"}
            </label>

            <textarea
              id={`${prefix}-notes`}
              name="notes"
              rows={3}
              maxLength={1000}
              required={closureReasonRequired}
              defaultValue={report?.notes ?? ""}
              placeholder="Pickup instructions or an explanation of the outcome"
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white hover:bg-[#066452] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {pending
              ? "Saving…"
              : report
                ? "Save surplus update"
                : "Report available surplus"}
          </button>
        </fieldset>

        <div aria-live="polite" aria-atomic="true">
          {state.message && (
            <p
              className={`rounded-xl p-4 text-sm ${
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
    </article>
  );
}