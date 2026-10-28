"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { decodeJwt } from "jose";

import {
  enqueueOfflineScan,
  getLocalCollection,
  getOrCreateDeviceId,
  getStoredScans,
  recordOnlineCollection,
  savePreparation,
} from "@/lib/offline-scanning/storage";

import {
  createOfflineClockAnchor,
  verifyOfflineMealToken,
} from "@/lib/offline-scanning/verify";

import { syncPendingScans } from "@/lib/offline-scanning/sync";

import type {
  OfflineClockAnchor,
  OfflinePreparationResponse,
  StoredOfflinePreparation,
  StoredOfflineScan,
} from "@/lib/offline-scanning/types";

export type ScannerMeal = {
  id: string;
  meal_date: string;
  meal_type: string;
  menu: string;
  serve_start: string;
  serve_end: string;
};

type ScannerProps = {
  meals: ScannerMeal[];
  scannerId: string;
};

type ScanResult = {
  kind: "accepted" | "offline" | "rejected" | "uncertain";
  message: string;
  studentName?: string;
};

const buttonClass =
  "min-h-11 rounded-xl bg-[#087A68] px-5 py-3 font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryClass =
  "min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The operation could not be completed.";
}

export function MealScanner({
  meals,
  scannerId,
}: ScannerProps) {
  const [mealId, setMealId] = useState(meals[0]?.id ?? "");
  const [deviceId, setDeviceId] = useState("");
  const [storageError, setStorageError] = useState("");

  const [offlineMode, setOfflineMode] = useState(false);
  const [preparation, setPreparation] =
    useState<StoredOfflinePreparation | null>(null);

  const [records, setRecords] = useState<StoredOfflineScan[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [prepareMessage, setPrepareMessage] = useState("");

  const [manualToken, setManualToken] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const clockRef = useRef<OfflineClockAnchor | null>(null);

  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const startingRef = useRef(false);
  const preparingRef = useRef(false);
  const syncingRef = useRef(false);
  const cameraGeneration = useRef(0);

  const selectedMeal = meals.find((meal) => meal.id === mealId);

  const pendingCount = records.filter(
    (record) => record.status === "PENDING_SYNC"
  ).length;

  const reviewRecords = records.filter(
    (record) =>
      record.status === "CONFLICT" ||
      record.status === "REJECTED"
  );

  const stopCamera = useCallback(() => {
    cameraGeneration.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;

    const video = videoRef.current;
    const stream = video?.srcObject;

    if (
      typeof MediaStream !== "undefined" &&
      stream instanceof MediaStream
    ) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (video) video.srcObject = null;
    if (mountedRef.current) setCameraOn(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      stopCamera();
      requestRef.current?.abort();
      clockRef.current = null;
    };
  }, [stopCamera]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const id = await getOrCreateDeviceId();
        const saved = await getStoredScans(scannerId, id);

        if (!cancelled) {
          setDeviceId(id);
          setRecords(saved);
          setStorageError("");
        }
      } catch (error) {
        if (!cancelled) {
          setStorageError(errorMessage(error));
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [scannerId]);

  const reloadRecords = useCallback(async () => {
    if (!deviceId) return;

    try {
      const saved = await getStoredScans(scannerId, deviceId);

      if (mountedRef.current) {
        setRecords(saved);
      }
    } catch (error) {
      if (mountedRef.current) {
        setStorageError(errorMessage(error));
      }
    }
  }, [scannerId, deviceId]);

  const synchronize = useCallback(
    async (manual = false) => {
      if (
        !deviceId ||
        syncingRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      syncingRef.current = true;
      setSyncing(true);

      if (manual) setSyncMessage("Synchronizing…");

      try {
        const summary = await syncPendingScans(
          scannerId,
          deviceId
        );

        if (mountedRef.current) {
          setSyncMessage(
            `${summary.message} Confirmed: ${summary.confirmed}. ` +
              `Conflicts: ${summary.conflicts}. ` +
              `Rejected: ${summary.rejected}. ` +
              `Pending: ${summary.pending}.`
          );
        }
      } catch (error) {
        if (mountedRef.current) {
          setSyncMessage(errorMessage(error));
        }
      } finally {
        await reloadRecords();
        syncingRef.current = false;

        if (mountedRef.current) {
          setSyncing(false);
        }
      }
    },
    [deviceId, scannerId, reloadRecords]
  );

  useEffect(() => {
    if (!deviceId) return;

    function attemptSync() {
      // navigator.onLine is only a hint.
      // The request itself determines whether sync works.
      if (navigator.onLine) {
        void synchronize();
      }
    }

    const firstAttempt = window.setTimeout(attemptSync, 0);
    const interval = window.setInterval(attemptSync, 60000);

    window.addEventListener("online", attemptSync);

    return () => {
      window.clearTimeout(firstAttempt);
      window.clearInterval(interval);
      window.removeEventListener("online", attemptSync);
    };
  }, [deviceId, synchronize]);

  async function prepareOffline() {
    if (
      !selectedMeal ||
      !deviceId ||
      preparingRef.current ||
      busyRef.current ||
      startingRef.current ||
      cameraOn
    ) {
      return;
    }

    preparingRef.current = true;
    setPreparing(true);
    setPrepareMessage("");
    setOfflineMode(false);
    setPreparation(null);
    clockRef.current = null;

    const controller = new AbortController();
    requestRef.current = controller;

    let timeout: number | undefined;

    try {
      // Load camera decoder assets while internet is available.
      await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);

      if (!mountedRef.current) return;

      const requestStartedAt = performance.now();

      timeout = window.setTimeout(
        () => controller.abort(),
        10000
      );

      const response = await fetch(
        "/api/checkin/offline/prepare",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            mealId,
            deviceId,
          }),
        }
      );

      const body = await response.json();

      if (
        !response.ok ||
        body?.code !== "OFFLINE_PREPARED"
      ) {
        throw new Error(
          typeof body?.message === "string"
            ? body.message
            : "Offline preparation failed."
        );
      }

      const prepared = body as OfflinePreparationResponse;

      if (
        prepared.session.scannerId !== scannerId ||
        prepared.session.deviceId !== deviceId ||
        prepared.session.mealId !== mealId
      ) {
        throw new Error(
          "Preparation does not match this account, device, or meal."
        );
      }

      const stored: StoredOfflinePreparation = {
        sessionId: prepared.session.sessionId,
        session: prepared.session,
        verification: prepared.verification,
        downloadedAt: new Date().toISOString(),
      };

      const anchor = createOfflineClockAnchor(
        stored,
        requestStartedAt
      );

      await savePreparation(stored);

      if (!mountedRef.current) return;

      clockRef.current = anchor;
      setPreparation(stored);
      setPrepareMessage(
        `Preparation saved for ${stored.session.eligibleCount} eligible students. ` +
          "You can now select Offline mode if needed."
      );
    } catch (error) {
      if (mountedRef.current) {
        setPrepareMessage(
          error instanceof Error && error.name === "AbortError"
            ? "Preparation timed out. Stay online and try again."
            : errorMessage(error)
        );
      }
    } finally {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }

      if (requestRef.current === controller) {
        requestRef.current = null;
      }

      preparingRef.current = false;

      if (mountedRef.current) setPreparing(false);
    }
  }

  async function submitToken(rawToken: string) {
    if (
      busyRef.current ||
      preparingRef.current ||
      !mountedRef.current
    ) {
      return;
    }

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

    try {
      if (offlineMode) {
        if (!preparation || !clockRef.current || !deviceId) {
          throw new Error(
            "Prepare offline scanning online before using offline mode."
          );
        }

        const verified = await verifyOfflineMealToken({
          token,
          preparation,
          anchor: clockRef.current,
          scannerId,
          deviceId,
          selectedMealId: mealId,
        });

        const scan: StoredOfflineScan = {
          scanId: crypto.randomUUID(),
          sessionId: preparation.sessionId,
          scannerId,
          deviceId,
          mealId: verified.mealId,
          studentId: verified.studentId,
          tokenId: verified.tokenId,
          tokenIssuedAt: verified.issuedAt,
          tokenExpiresAt: verified.expiresAt,
          token,
          observedAt: verified.observedAt,
          status: "PENDING_SYNC",
          syncAttempts: 0,
          lastSyncAttemptAt: null,
          resultCode: null,
          resultMessage: null,
          redemptionId: null,
          syncedAt: null,
        };

        // This also checks duplicates atomically.
        await enqueueOfflineScan(scan);

        if (mountedRef.current) {
          setResult({
            kind: "offline",
            message:
              "Saved on this browser. Acceptance is provisional until sync. " +
              "Other disconnected scanners cannot see this collection.",
          });
        }

        await reloadRecords();
        return;
      }

      // Read claims only to check an existing local duplicate.
      // These unverified claims NEVER authorize acceptance.
      let claimedStudentId: string | null = null;

      try {
        const claims = decodeJwt(token);

        if (
          typeof claims.sub === "string" &&
          UUID_PATTERN.test(claims.sub) &&
          typeof claims.slot === "string" &&
          claims.slot.toLowerCase() === mealId.toLowerCase()
        ) {
          claimedStudentId = claims.sub.toLowerCase();
        }
      } catch {
        // The backend will reject invalid tokens.
      }

      if (deviceId && claimedStudentId) {
        const marker = await getLocalCollection(
          mealId.toLowerCase(),
          claimedStudentId
        );

        if (marker) {
          if (mountedRef.current) {
            setResult({
              kind: "rejected",
              message:
                "This student already has a local collection or pending scan. " +
                "Sync and review it before attempting another collection.",
            });
          }
          return;
        }
      }

      const controller = new AbortController();
      requestRef.current = controller;

      const timeout = window.setTimeout(
        () => controller.abort(),
        15000
      );

      try {
        const response = await fetch("/api/checkin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({ token, mealId }),
        });

        const body = await response.json();

        if (
          response.ok &&
          body?.code === "CHECKIN_ACCEPTED" &&
          typeof body.redemptionId === "string"
        ) {
          let localWarning = "";

          // The backend has now verified this token.
          if (deviceId && claimedStudentId) {
            try {
              await recordOnlineCollection({
                mealId: mealId.toLowerCase(),
                studentId: claimedStudentId,
                scanId: crypto.randomUUID(),
                source: "ONLINE",
                recordedAt: new Date().toISOString(),
              });
            } catch {
              localWarning =
                " Local duplicate tracking failed. Stay online.";

              clockRef.current = null;

              if (mountedRef.current) {
                setPreparation(null);
                setOfflineMode(false);
              }
            }
          }

          if (mountedRef.current) {
            setResult({
              kind: "accepted",
              message:
                "Meal accepted. You may serve this student." +
                localWarning,
              studentName:
                typeof body.studentName === "string"
                  ? body.studentName
                  : undefined,
            });
          }
        } else if (mountedRef.current) {
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
        if (mountedRef.current) {
          setResult({
            kind: "uncertain",
            message:
              "The server may have recorded this collection. " +
              "Check the redemption record before serving or rescanning. " +
              "This request was not automatically queued offline.",
          });
        }
      } finally {
        window.clearTimeout(timeout);

        if (requestRef.current === controller) {
          requestRef.current = null;
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        setResult({
          kind: "rejected",
          message: errorMessage(error),
        });
      }
    } finally {
      busyRef.current = false;

      if (mountedRef.current) setBusy(false);
    }
  }

  async function startCamera() {
    if (
      !selectedMeal ||
      busyRef.current ||
      preparingRef.current ||
      startingRef.current ||
      cameraOn
    ) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera access requires HTTPS or localhost."
      );
      return;
    }

    startingRef.current = true;
    setStarting(true);
    setCameraError("");
    setResult(null);

    const generation = ++cameraGeneration.current;

    try {
      const [
        { BrowserQRCodeReader },
        { DecodeHintType, BarcodeFormat },
      ] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);

      if (
        !mountedRef.current ||
        generation !== cameraGeneration.current ||
        !videoRef.current
      ) {
        return;
      }

      const hints = new Map<
        import("@zxing/library").DecodeHintType,
        boolean | import("@zxing/library").BarcodeFormat[]
      >();

      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserQRCodeReader(hints);

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

        const name =
          error instanceof Error ? error.name : "";

        setCameraError(
          name === "NotAllowedError"
            ? "Allow camera permission and try again."
            : name === "NotFoundError"
              ? "No camera was found."
              : "Unable to start the camera. Close other camera apps and try again."
        );
      }
    } finally {
      startingRef.current = false;

      if (mountedRef.current) setStarting(false);
    }
  }

  const controlsBusy =
    busy || starting || cameraOn || preparing;

  const resultStyle =
    result?.kind === "accepted"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : result?.kind === "offline" ||
          result?.kind === "uncertain"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-900";

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">
          Offline queue
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Pending: {pendingCount} · Needs review:{" "}
          {reviewRecords.length}
        </p>

        {!deviceId && !storageError && (
          <p className="mt-2 text-sm">
            Opening local storage…
          </p>
        )}

        {storageError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            Offline storage: {storageError}
          </p>
        )}

        <button
          type="button"
          disabled={!deviceId || syncing}
          onClick={() => void synchronize(true)}
          className={`mt-4 ${buttonClass}`}
        >
          {syncing ? "Synchronizing…" : "Sync now"}
        </button>

        <p role="status" className="mt-3 text-sm text-slate-600">
          {syncMessage}
        </p>

        <p className="mt-3 text-xs leading-5 text-slate-500">
          Automatic sync runs when connectivity returns and
          every minute while this page is open. Keep this
          browser’s site data until all scans are resolved.
        </p>

        {reviewRecords.length > 0 && (
          <details className="mt-4 rounded-xl bg-amber-50 p-4">
            <summary className="cursor-pointer font-semibold">
              Review conflicts and rejected scans
            </summary>

            <ul className="mt-3 space-y-3">
              {reviewRecords.map((record) => (
                <li
                  key={record.scanId}
                  className="break-words text-sm"
                >
                  <p className="font-semibold">
                    {record.status}
                  </p>
                  <p>{record.resultMessage}</p>
                  <p className="mt-1 text-xs">
                    Student: {record.studentId}
                  </p>
                  <p className="text-xs">
                    Scan: {record.scanId}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {meals.length === 0 ? (
        <div className="rounded-2xl border bg-white p-5">
          <p>No meals are currently available for scanning.</p>
          <p className="mt-2 text-sm text-slate-600">
            You can still synchronize previously queued scans.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`mt-4 ${secondaryClass}`}
          >
            Refresh meals
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border bg-white p-5">
            <label
              htmlFor="scanner-meal"
              className="block font-semibold"
            >
              Meal being served
            </label>

            <select
              id="scanner-meal"
              value={selectedMeal ? mealId : ""}
              disabled={controlsBusy}
              onChange={(event) => {
                setMealId(event.target.value);
                setResult(null);
                setManualToken("");
                setOfflineMode(false);
                setPreparation(null);
                setPrepareMessage("");
                clockRef.current = null;
              }}
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
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

            <p className="mt-3 text-sm text-slate-600">
              {selectedMeal?.menu}
            </p>

            <button
              type="button"
              disabled={
                controlsBusy ||
                !deviceId ||
                !selectedMeal ||
                Boolean(storageError)
              }
              onClick={() => void prepareOffline()}
              className={`mt-4 ${secondaryClass}`}
            >
              {preparing
                ? "Preparing…"
                : "Prepare offline scanning"}
            </button>

            <p role="status" className="mt-3 text-sm">
              {prepareMessage}
            </p>

            {preparation && (
              <p className="mt-2 text-sm text-slate-600">
                Capture deadline:{" "}
                {new Intl.DateTimeFormat("en-IN", {
                  timeZone: "Asia/Kolkata",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(
                  new Date(
                    preparation.session.captureExpiresAt
                  )
                )}{" "}
                IST. Every scan rechecks expiry.
              </p>
            )}

            <label className="mt-5 flex items-center gap-3 font-medium">
              <input
                type="checkbox"
                checked={offlineMode}
                disabled={
                  controlsBusy ||
                  !preparation ||
                  Boolean(storageError)
                }
                onChange={(event) => {
                  setOfflineMode(event.target.checked);
                  setResult(null);
                }}
                className="h-5 w-5 accent-emerald-700"
              />
              Offline mode — queue scans on this device
            </label>

            <p className="mt-2 text-xs leading-5 text-slate-500">
              Use one designated offline scanner where possible.
              Offline preparation does not reserve meals or
              prevent duplicates on other devices.
            </p>
          </div>

          {result && (
            <div
              role={
                result.kind === "accepted" ||
                result.kind === "offline"
                  ? "status"
                  : "alert"
              }
              className={`rounded-2xl border p-5 ${resultStyle}`}
            >
              <h2 className="text-xl font-bold">
                {result.kind === "accepted"
                  ? "Accepted"
                  : result.kind === "offline"
                    ? "Accepted offline — pending sync"
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

          <div className="rounded-2xl border bg-white p-5">
            <div className="overflow-hidden rounded-xl bg-slate-900">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                aria-label="QR scanner camera preview"
                className="aspect-video w-full object-contain"
              />
            </div>

            <p role="status" className="mt-3 text-sm text-slate-600">
              {busy
                ? offlineMode
                  ? "Verifying and saving offline…"
                  : "Checking meal eligibility…"
                : starting
                  ? "Opening camera…"
                  : cameraOn
                    ? "Hold the student's QR code inside the camera view."
                    : "Start the camera when ready."}
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
                disabled={controlsBusy || !selectedMeal}
                className={buttonClass}
              >
                {result ? "Scan next student" : "Start camera"}
              </button>

              {(cameraOn || starting) && (
                <button
                  type="button"
                  onClick={stopCamera}
                  className={secondaryClass}
                >
                  Stop camera
                </button>
              )}
            </div>
          </div>

          <details className="rounded-2xl border bg-white p-5">
            <summary className="cursor-pointer font-semibold">
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
                onChange={(event) =>
                  setManualToken(event.target.value)
                }
                required
                maxLength={2048}
                rows={4}
                autoComplete="off"
                spellCheck={false}
                disabled={controlsBusy}
                className="w-full rounded-xl border border-slate-300 p-3"
              />

              <button
                type="submit"
                disabled={controlsBusy || !selectedMeal}
                className={buttonClass}
              >
                {busy ? "Checking…" : "Check meal pass"}
              </button>
            </form>
          </details>
        </>
      )}
    </section>
  );
}