"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function StudentMealPass({ mealId }: { mealId: string }) {
  // Changing meals resets the entire pass panel.
  return <MealPassPanel key={mealId} mealId={mealId} />;
}

function MealPassPanel({ mealId }: { mealId: string }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-xl font-bold text-[#152D33]">
        Your meal pass
      </h2>

      <p className="mt-2 text-sm text-slate-600">
        Open your pass when you are ready to collect your meal.
      </p>

      {open ? (
        <ActiveMealPass
          key={attempt}
          mealId={mealId}
          onClose={() => setOpen(false)}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-5 min-h-11 rounded-xl bg-[#087A68] px-5 py-3 font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2"
        >
          Show meal pass
        </button>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Keep your pass private. Each meal can be collected only once.
      </p>
    </section>
  );
}

function ActiveMealPass({
  mealId,
  onClose,
  onRetry,
}: {
  mealId: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [collected, setCollected] = useState(false);

  useEffect(() => {
    let disposed = false;
    let stopped = false;
    let deadline = 0;
    let failureCount = 0;

    let controller: AbortController | null = null;
    let refreshTimer: number | null = null;
    let requestTimeout: number | null = null;

    function clearRefreshTimer() {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    }

    function clearRequestTimeout() {
      if (requestTimeout !== null) {
        window.clearTimeout(requestTimeout);
        requestTimeout = null;
      }
    }

    function clearPass() {
      deadline = 0;
      setImageUrl(null);
      setSecondsLeft(0);
    }

    function scheduleRefresh(delay: number) {
      clearRefreshTimer();

      if (disposed || stopped || document.hidden) return;

      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        requestRefresh();
      }, delay);
    }

    function scheduleRetry(errorMessage: string) {
      failureCount += 1;

      // Back off: approximately 5, 10, 20, then 40 seconds.
      const baseDelay = Math.min(
        5000 * 2 ** Math.min(failureCount - 1, 3),
        40000,
      );

      // Spread retries slightly across different students.
      const delay = baseDelay + Math.floor(Math.random() * 1000);
      const seconds = Math.ceil(delay / 1000);

      setMessage(
        `${errorMessage} Retrying in about ${seconds} seconds.`,
      );

      scheduleRefresh(delay);
    }

    // Called only from timer or visibility events.
    function requestRefresh() {
      if (
        disposed ||
        stopped ||
        document.hidden ||
        controller !== null
      ) {
        return;
      }

      setLoading(true);
      setMessage("");
      void refreshPass();
    }

    async function refreshPass() {
      if (
        disposed ||
        stopped ||
        document.hidden ||
        controller !== null
      ) {
        return;
      }

      const requestStarted = performance.now();
      const requestController = new AbortController();
      controller = requestController;

      const timeout = window.setTimeout(() => {
        requestController.abort();
      }, 10000);

      requestTimeout = timeout;

      function isCurrentRequest() {
        return (
          !disposed &&
          !document.hidden &&
          controller === requestController
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

        // A proxy may return non-JSON errors.
        const body = await response.json().catch(() => null);

        if (!isCurrentRequest()) return;

        if (!response.ok) {
          clearPass();

          const errorMessage =
            typeof body?.message === "string"
              ? body.message
              : "Unable to load your meal pass.";

          if (response.status === 429) {
            // Support rate limiting if it is added to the API.
            const retryAfter = response.headers.get("Retry-After");

            let delay = 30000;

            if (retryAfter) {
              const seconds = Number(retryAfter);

              if (Number.isFinite(seconds) && seconds >= 0) {
                delay = seconds * 1000;
              } else {
                const retryDate = Date.parse(retryAfter);

                if (Number.isFinite(retryDate)) {
                  delay = retryDate - Date.now();
                }
              }
            }

            delay = Math.min(
              2147483647,
              Math.max(5000, delay),
            );

            setMessage(
              `${errorMessage} Retrying in about ${Math.ceil(
                delay / 1000,
              )} seconds.`,
            );

            scheduleRefresh(delay);
            return;
          }

          if (response.status >= 400 && response.status < 500) {
            // Your API uses these responses for authentication,
            // eligibility and serving-window rejections.
            stopped = true;
            clearRefreshTimer();

            setCollected(body?.code === "ALREADY_REDEEMED");
            setMessage(errorMessage);
            return;
          }

          scheduleRetry(errorMessage);
          return;
        }

        if (
          typeof body?.token !== "string" ||
          body.token.length === 0 ||
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
            "The pass expired before it could be displayed.",
          );
        }

        // Preserve the existing 30-second display cap.
        // Subtract request time by starting from requestStarted.
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

        const remaining = nextDeadline - performance.now();

        if (remaining <= 0) {
          throw new Error(
            "The pass expired while loading.",
          );
        }

        deadline = nextDeadline;
        failureCount = 0;

        setImageUrl(nextImage);
        setSecondsLeft(Math.ceil(remaining / 1000));
        setMessage("");
        setCollected(false);

        // Normally refresh five seconds before display expiry.
        // For a nearly expired pass, wait until expiry instead
        // of creating a rapid refresh loop.
        const refreshDelay =
          remaining > 5000
            ? remaining - 5000
            : remaining;

        scheduleRefresh(Math.max(1000, refreshDelay));
      } catch (error) {
        if (!isCurrentRequest()) return;

        clearPass();

        const errorMessage =
          error instanceof Error && error.name === "AbortError"
            ? "The request timed out."
            : error instanceof Error
              ? error.message
              : "Unable to load your meal pass.";

        scheduleRetry(errorMessage);
      } finally {
        window.clearTimeout(timeout);

        if (requestTimeout === timeout) {
          requestTimeout = null;
        }

        if (controller === requestController) {
          controller = null;

          if (!disposed) {
            setLoading(false);
          }
        }
      }
    }

    const countdownTimer = window.setInterval(() => {
      if (disposed || document.hidden) return;

      const remaining = Math.max(
        0,
        Math.ceil((deadline - performance.now()) / 1000),
      );

      setSecondsLeft(remaining);

      if (remaining === 0) {
        setImageUrl(null);
      }
    }, 1000);

    function handleVisibilityChange() {
      if (disposed) return;

      clearRefreshTimer();
      clearRequestTimeout();

      // Invalidate first so the old request cannot update the UI.
      const previousController = controller;
      controller = null;
      previousController?.abort();

      clearPass();

      if (document.hidden || stopped) {
        setLoading(false);
        return;
      }

      requestRefresh();
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    // Initial loading state is already true.
    void refreshPass();

    return () => {
      disposed = true;

      clearRefreshTimer();
      clearRequestTimeout();

      controller?.abort();
      controller = null;

      window.clearInterval(countdownTimer);

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [mealId]);

  return (
    <>
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
              : "Show this code to the scanner staff."}
          </p>
        </>
      ) : (
        <div className="my-6 rounded-xl bg-slate-50 p-6">
          {collected && (
            <p className="mb-2 font-semibold text-[#087A68]">
              Meal collected
            </p>
          )}

          <p role="status" className="text-sm text-slate-700">
            {loading
              ? "Creating your meal pass…"
              : message ||
                "Your pass has expired. Request a new one."}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {!collected && (
          <button
            type="button"
            disabled={loading}
            onClick={onRetry}
            className="min-h-11 rounded-xl bg-[#087A68] px-5 py-3 font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Please wait…" : "Refresh pass"}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-[#152D33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2"
        >
          Close pass
        </button>
      </div>
    </>
  );
}