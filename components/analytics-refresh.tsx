"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AnalyticsRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function refreshIfVisible() {
      if (document.hidden || isPending) return;

      startTransition(() => {
        router.refresh();
      });
    }

    const timer = window.setInterval(refreshIfVisible, 30_000);

    document.addEventListener(
      "visibilitychange",
      refreshIfVisible,
    );

    return () => {
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        refreshIfVisible,
      );
    };
  }, [router, isPending]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
        className="rounded-lg border border-[#087A68] px-4 py-2 text-sm font-medium text-[#087A68] disabled:opacity-50"
      >
        {isPending ? "Refreshing…" : "Refresh now"}
      </button>

      <p
        role="status"
        className="text-xs text-slate-600"
      >
        Updates every 30 seconds while visible.
      </p>
    </div>
  );
}