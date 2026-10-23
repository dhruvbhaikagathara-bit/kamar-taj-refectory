"use client";

import { useActionState, useEffect, useState } from "react";
import { changeMealChoice } from "@/app/student/actions";

type Props = {
  mealId: string;
  status: "OPTED_IN" | "OPTED_OUT" | null;
  cutoffAt: string;
  serverNow: number;
};

const initialState = {
  success: false,
  message: "",
};

function formatRemaining(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days > 0 ? `${days}d ` : ""}${hours}h ${minutes}m ${seconds}s`;
}

export function MealChoiceControls({
  mealId,
  status,
  cutoffAt,
  serverNow,
}: Props) {
  const [now, setNow] = useState(serverNow);

  const [state, formAction, pending] = useActionState(
    changeMealChoice.bind(null, mealId),
    initialState
  );

  useEffect(() => {
    const startedAt = performance.now();

    const timer = window.setInterval(() => {
      setNow(serverNow + performance.now() - startedAt);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [serverNow]);

  const cutoff = new Date(cutoffAt).getTime();
  const closed = now >= cutoff;

  const remainingSeconds = Math.max(
    0,
    Math.ceil((cutoff - now) / 1000)
  );

  const choiceLabel =
    status === "OPTED_IN"
      ? "You’re eating"
      : status === "OPTED_OUT"
        ? "You’re skipping"
        : "No choice saved";

  return (
    <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            status === "OPTED_IN"
              ? "bg-emerald-50 text-emerald-800"
              : status === "OPTED_OUT"
                ? "bg-amber-50 text-amber-800"
                : "bg-slate-100 text-slate-700"
          }`}
        >
          {choiceLabel}
        </span>

        <span className="text-sm text-slate-600">
          {closed
            ? "Changes closed"
            : `Closes in ${formatRemaining(remainingSeconds)}`}
        </span>
      </div>

      <form action={formAction}>
        <fieldset
          disabled={pending || closed}
          className="grid grid-cols-2 gap-3"
        >
          <legend className="sr-only">Choose whether to eat this meal</legend>

          <button
            type="submit"
            name="status"
            value="OPTED_IN"
            disabled={pending || closed || status === "OPTED_IN"}
            className="rounded-lg bg-[#087A68] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#103C39] disabled:cursor-not-allowed disabled:opacity-50"
          >
            I’ll eat
          </button>

          <button
            type="submit"
            name="status"
            value="OPTED_OUT"
            disabled={pending || closed || status === "OPTED_OUT"}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-[#152D33] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Skip meal
          </button>
        </fieldset>
      </form>

      {closed && (
        <p className="text-sm text-slate-600">
          The deadline has passed. Meal choices are locked.
        </p>
      )}

      <div aria-live="polite" aria-atomic="true">
        {pending ? (
          <p className="text-sm text-slate-600">Saving your choice...</p>
        ) : state.message ? (
          <p
            className={`text-sm ${
              state.success ? "text-emerald-800" : "text-red-700"
            }`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}