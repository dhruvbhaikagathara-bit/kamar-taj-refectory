"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function StudentMealPass({ mealId }: { mealId: string }) {
  const [retry, setRetry] = useState(0);

  return (
    <MealPassContent
      key={`${mealId}:${retry}`}
      mealId={mealId}
      onRefresh={() => setRetry((value) => value + 1)}
    />
  );
}

function MealPassContent({
  mealId,
  onRefresh,
}: {
  mealId: string;
  onRefresh: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    let deadline = 0;
    let controller: AbortController | null = null;

    async function refreshPass() {
      if (disposed || controller !== null || document.hidden) {
        return;
      }

      const requestStarted = performance.now();
      const requestController = new AbortController();
      controller = requestController;

      const timeout = window.setTimeout(
        () => requestController.abort(),
        10000,
      );

      function isCurrentRequest() {
        return (
          !disposed &&
          controller === requestController &&
          !document.hidden
        );
      }

      try {
        const response = await fetch(
          `/api/meals/qr?mealId=${encodeURIComponent(mealId)}`,
          {
            cache: "no-store",
            signal: requestController.signal,
          },
        );

        const body = await response.json();

        if (!isCurrentRequest()) return;

        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string"
              ? body.message
              : "Unable to load your meal pass.",
          );
        }

        if (
          typeof body?.token !== "string" ||
          typeof body?.expiresAt !== "string" ||
          typeof body?.serverNow !== "string"
        ) {
          throw new Error(
            "The server returned an invalid meal pass.",
          );
        }

        const lifetime =
          Date.parse(body.expiresAt) - Date.parse(body.serverNow);

        if (!Number.isFinite(lifetime) || lifetime <= 0) {
          throw new Error(
            "This pass has expired. Please try again.",
          );
        }

        // Subtract request time conservatively.
        // performance.now() avoids relying on the browser's wall clock.
        const nextDeadline =
          requestStarted + Math.min(lifetime, 30000);

        const nextImage = await QRCode.toDataURL(body.token, {
          width: 320,
          margin: 4,
          errorCorrectionLevel: "M",
          color: {
            dark: "#103C39",
            light: "#FFFFFF",
          },
        });

        if (!isCurrentRequest()) return;

        if (nextDeadline <= performance.now()) {
          throw new Error(
            "The pass expired while loading. Try again.",
          );
        }

        deadline = nextDeadline;

        setImageUrl(nextImage);
        setSecondsLeft(
          Math.max(
            0,
            Math.ceil((deadline - performance.now()) / 1000),
          ),
        );
        setMessage("");
      } catch (error) {
        if (!isCurrentRequest()) return;

        deadline = 0;
        setImageUrl(null);
        setSecondsLeft(0);

        setMessage(
          error instanceof Error && error.name === "AbortError"
            ? "The request timed out. Check your connection and retry."
            : error instanceof Error
              ? error.message
              : "Unable to load your meal pass.",
        );
      } finally {
        window.clearTimeout(timeout);

        // An older request must not change a newer request's state.
        if (controller === requestController) {
          controller = null;

          if (!disposed) {
            setLoading(false);
          }
        }
      }
    }

    // Called by timer and visibility events, not during effect setup.
    function requestRefresh() {
      if (disposed || controller !== null || document.hidden) {
        return;
      }

      setLoading(true);
      setMessage("");
      void refreshPass();
    }

    const refreshTimer = window.setInterval(() => {
      requestRefresh();
    }, 20000);

    const countdownTimer = window.setInterval(() => {
      if (disposed) return;

      const remaining = Math.max(
        0,
        Math.ceil((deadline - performance.now()) / 1000),
      );

      setSecondsLeft(remaining);

      if (remaining === 0) {
        setImageUrl(null);
      }
    }, 250);

    function handleVisibilityChange() {
      if (disposed) return;

      // Invalidate the previous request before aborting it.
      const previousController = controller;
      controller = null;
      previousController?.abort();

      deadline = 0;
      setImageUrl(null);
      setSecondsLeft(0);
      setMessage("");

      if (document.hidden) {
        setLoading(false);
      } else {
        requestRefresh();
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    // Initial loading state already comes from useState(true).
    // State updates happen after the asynchronous request completes.
    void refreshPass();

    return () => {
      disposed = true;

      controller?.abort();
      controller = null;

      window.clearInterval(refreshTimer);
      window.clearInterval(countdownTimer);

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [mealId]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-xl font-bold text-[#152D33]">
        Your meal pass
      </h2>

      <p className="mt-2 text-sm text-slate-600">
        Show this QR code to the scanner staff.
      </p>

      {imageUrl && secondsLeft > 0 ? (
        <>
          <Image
            src={imageUrl}
            alt="Your signed meal collection QR code"
            width={320}
            height={320}
            unoptimized
            className="mx-auto mt-5 h-auto w-full max-w-[320px]"
          />

          <p className="font-semibold text-[#087A68]">
            Expires in {secondsLeft}s
          </p>

          <p className="mt-2 text-sm text-slate-500">
            {loading
              ? "Refreshing pass…"
              : "Refreshes automatically."}
          </p>
        </>
      ) : (
        <div className="my-6 rounded-xl bg-slate-50 p-6">
          <p role="status" className="text-sm text-slate-700">
            {loading
              ? "Creating your meal pass…"
              : message ||
                "Your pass has expired. Request a new one."}
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={onRefresh}
        className="mt-5 min-h-11 rounded-xl bg-[#087A68] px-5 py-3 font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Please wait…" : "Refresh pass"}
      </button>

      <p className="mt-4 text-xs text-slate-500">
        Keep your pass private. Each meal can be collected only once.
      </p>
    </section>
  );
}