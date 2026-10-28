"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

export function AnalyticsRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [automatic, setAutomatic] = useState(true);

  const editingRef = useRef(false);

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // Pause automatic updates when an admin changes a form.
  // This helps protect unfinished waste or surplus entries.
  useEffect(() => {
    function handleEdit(event: Event) {
      const target = event.target;

      if (
        target instanceof HTMLElement &&
        target.closest("form")
      ) {
        editingRef.current = true;
        setAutomatic(false);
      }
    }

    document.addEventListener("input", handleEdit, true);
    document.addEventListener("change", handleEdit, true);

    return () => {
      document.removeEventListener("input", handleEdit, true);
      document.removeEventListener("change", handleEdit, true);
    };
  }, []);

  useEffect(() => {
    if (!automatic || pending) return;

    function refreshWhenAvailable() {
      if (
        document.hidden ||
        !navigator.onLine ||
        editingRef.current
      ) {
        return;
      }

      refresh();
    }

    const timer = window.setInterval(
      refreshWhenAvailable,
      15_000
    );

    document.addEventListener(
      "visibilitychange",
      refreshWhenAvailable
    );
    window.addEventListener("online", refreshWhenAvailable);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        refreshWhenAvailable
      );
      window.removeEventListener(
        "online",
        refreshWhenAvailable
      );
    };
  }, [automatic, pending, refresh]);

  function toggleAutomatic() {
    if (automatic) {
      setAutomatic(false);
      return;
    }

    editingRef.current = false;
    setAutomatic(true);
    refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="min-h-11 rounded-lg bg-[#087A68] px-4 py-2 text-sm font-semibold text-white hover:bg-[#066452] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Refreshing…" : "Refresh now"}
        </button>

        <button
          type="button"
          onClick={toggleAutomatic}
          disabled={pending}
          aria-pressed={automatic}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#103C39] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {automatic
            ? "Pause auto-refresh"
            : "Resume auto-refresh"}
        </button>
      </div>

      <p
        role="status"
        className="max-w-sm text-xs leading-5 text-slate-600"
      >
        {automatic
          ? "Checks for updates every 15 seconds while this tab is visible and connected."
          : "Auto-refresh paused. Finish and save any form edits before refreshing or resuming."}
      </p>
    </div>
  );
}