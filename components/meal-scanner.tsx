"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ScannerMeal = {
  id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  serve_start: string;
  serve_end: string;
};

type ScanResult = {
  kind: "accepted" | "rejected" | "uncertain";
  message: string;
  studentName?: string;
};

export function MealScanner({ meals }: { meals: ScannerMeal[] }) {
  const [mealId, setMealId] = useState(meals[0]?.id ?? "");
  const [manualToken, setManualToken] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const startingRef = useRef(false);
  const cameraGeneration = useRef(0);

  const selectedMeal = meals.find((meal) => meal.id === mealId);

  const stopCamera = useCallback(() => {
    cameraGeneration.current += 1;

    controlsRef.current?.stop();
    controlsRef.current = null;

    const video = videoRef.current;
    const stream = video?.srcObject;

    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (video) video.srcObject = null;

    if (mountedRef.current) setCameraOn(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setBusy(false);

    return () => {
      mountedRef.current = false;
      stopCamera();
      requestRef.current?.abort();
      requestRef.current = null;
      busyRef.current = false;
    };
  }, [stopCamera]);

  async function submitToken(rawToken: string) {
    if (busyRef.current || !mountedRef.current) return;

    const token = rawToken.trim();

    if (!selectedMeal || !token || token.length > 2048) {
      setResult({
        kind: "rejected",
        message: "Select a meal and provide a valid QR token.",
      });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setResult(null);
    setManualToken("");
    stopCamera();

    const controller = new AbortController();
    requestRef.current = controller;

    const timeout = window.setTimeout(
      () => controller.abort(),
      15000
    );

    function isCurrentRequest() {
      return (
        mountedRef.current &&
        requestRef.current === controller
      );
    }

    try {
      const response = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ token, mealId }),
      });

      const body = await response.json();

      if (!isCurrentRequest()) return;

      if (
        response.ok &&
        body?.code === "CHECKIN_ACCEPTED" &&
        typeof body.redemptionId === "string"
      ) {
        setResult({
          kind: "accepted",
          message: "Meal accepted. You may serve this student.",
          studentName:
            typeof body.studentName === "string"
              ? body.studentName
              : undefined,
        });
      } else {
        setResult({
          kind:
            response.status >= 500 || response.ok
              ? "uncertain"
              : "rejected",
          message:
            typeof body?.message === "string"
              ? body.message
              : "Unable to confirm this scan.",
        });
      }
    } catch {
      if (isCurrentRequest()) {
        setResult({
          kind: "uncertain",
          message:
            "The result could not be confirmed. Check the redemption record before serving.",
        });
      }
    } finally {
      window.clearTimeout(timeout);

      if (requestRef.current === controller) {
        requestRef.current = null;
        busyRef.current = false;

        if (mountedRef.current) setBusy(false);
      }
    }
  }

  async function startCamera() {
    if (
      !selectedMeal ||
      busyRef.current ||
      startingRef.current ||
      cameraOn
    ) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera access requires HTTPS or localhost in a supported browser."
      );
      return;
    }

    startingRef.current = true;
    setStarting(true);
    setCameraError("");
    setResult(null);

    const generation = ++cameraGeneration.current;

    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");

      if (
        !mountedRef.current ||
        generation !== cameraGeneration.current ||
        !videoRef.current
      ) {
        return;
      }

      const reader = new BrowserQRCodeReader();

      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current,
        (decoded, _error, scanControls) => {
          if (
            !mountedRef.current ||
            generation !== cameraGeneration.current
          ) {
            scanControls.stop();
            return;
          }

          if (decoded && !busyRef.current) {
            scanControls.stop();
            void submitToken(decoded.getText());
          }
        }
      );

      if (
        !mountedRef.current ||
        generation !== cameraGeneration.current
      ) {
        controls.stop();
        return;
      }

      controlsRef.current = controls;
      setCameraOn(true);
    } catch (error) {
      if (
        mountedRef.current &&
        generation === cameraGeneration.current
      ) {
        stopCamera();

        const name = error instanceof Error ? error.name : "";

        setCameraError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and try again."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : "Unable to start the camera. Close other camera apps and try again."
        );
      }
    } finally {
      startingRef.current = false;

      if (mountedRef.current) setStarting(false);
    }
  }

  if (meals.length === 0) {
    return (
      <div className="rounded-2xl border bg-white p-6">
        <p>No meals are available for scanning.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-xl bg-[#087A68] px-5 py-3 text-white"
        >
          Refresh page
        </button>
      </div>
    );
  }

  const resultStyle =
    result?.kind === "accepted"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : result?.kind === "uncertain"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-900";

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <label
          htmlFor="scanner-meal"
          className="block font-semibold text-[#152D33]"
        >
          Meal being served
        </label>

        <select
          id="scanner-meal"
          value={selectedMeal ? mealId : ""}
          disabled={busy || cameraOn || starting}
          onChange={(event) => {
            setMealId(event.target.value);
            setResult(null);
            setManualToken("");
          }}
          className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#087A68]"
        >
          <option value="" disabled>
            Select a meal
          </option>

          {meals.map((meal) => (
            <option key={meal.id} value={meal.id}>
              {meal.meal_date} · {meal.meal_type}
            </option>
          ))}
        </select>

        {selectedMeal && (
          <p className="mt-3 text-sm text-slate-600">
            {selectedMeal.menu}
          </p>
        )}
      </div>

      {result && (
        <div
          role={result.kind === "accepted" ? "status" : "alert"}
          className={`rounded-2xl border p-6 ${resultStyle}`}
        >
          <h2 className="text-xl font-bold">
            {result.kind === "accepted"
              ? "Accepted"
              : result.kind === "uncertain"
                ? "Result unconfirmed"
                : "Not accepted"}
          </h2>

          {result.studentName && (
            <p className="mt-2 font-semibold">
              {result.studentName}
            </p>
          )}

          <p className="mt-2">{result.message}</p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="overflow-hidden rounded-xl bg-slate-900">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="QR scanner camera preview"
            className="aspect-video w-full object-cover"
          />
        </div>

        <p role="status" className="mt-3 text-sm text-slate-600">
          {busy
            ? "Checking meal eligibility…"
            : starting
              ? "Opening camera…"
              : cameraOn
                ? "Hold the student's QR code inside the camera view."
                : "Start the camera when you are ready to scan."}
        </p>

        {cameraError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {cameraError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={busy || starting || cameraOn || !selectedMeal}
            className="min-h-12 rounded-xl bg-[#087A68] px-5 py-3 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {result ? "Scan next student" : "Start camera"}
          </button>

          {(cameraOn || starting) && (
            <button
              type="button"
              onClick={stopCamera}
              className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 font-semibold"
            >
              Stop camera
            </button>
          )}
        </div>
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white p-6">
        <summary className="cursor-pointer font-semibold text-[#152D33]">
          Manual token entry
        </summary>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitToken(manualToken);
          }}
        >
          <label htmlFor="manual-token" className="block text-sm">
            Paste the QR token
          </label>

          <textarea
            id="manual-token"
            value={manualToken}
            onChange={(event) => setManualToken(event.target.value)}
            required
            maxLength={2048}
            rows={4}
            autoComplete="off"
            spellCheck={false}
            disabled={busy || cameraOn || starting}
            className="w-full rounded-xl border border-slate-300 p-3 focus:outline-none focus:ring-2 focus:ring-[#087A68]"
          />

          <button
            type="submit"
            disabled={busy || cameraOn || starting || !selectedMeal}
            className="min-h-11 rounded-xl bg-[#103C39] px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Checking…" : "Check meal pass"}
          </button>
        </form>
      </details>
    </section>
  );
}