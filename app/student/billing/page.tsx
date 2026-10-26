import { Suspense } from "react";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  formatPaise,
  getCurrentBillingMonth,
  isBillingMonth,
  type MonthlyRebates,
} from "@/lib/billing";

type PageProps = {
  searchParams: Promise<{
    month?: string | string[];
  }>;
};

function formatMonth(month: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function formatMealDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatRecordedAt(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function mealLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

async function RebateContent({ searchParams }: PageProps) {
  await requireRole("STUDENT");

  const params = await searchParams;
  const month = params.month ?? getCurrentBillingMonth();

  if (
    typeof month !== "string" ||
    !isBillingMonth(month)
  ) {
    return (
      <section className="kt-finance">
        <header>
          <h1>Choose a valid month</h1>
          <p className="mt-3 text-sm">
            Billing months use the YYYY-MM format.
          </p>
        </header>

        <a
          href="/student/billing"
          className="inline-flex rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white"
        >
          Open current month
        </a>
      </section>
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_my_monthly_rebates",
    { p_month: month },
  );

  if (error || !data) {
    return (
      <section className="kt-finance">
        <header>
          <h1>Rebate history</h1>
          <p className="mt-3 text-sm">
            Your meal credits, clearly accounted for.
          </p>
        </header>

        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
        >
          We couldn’t load your rebate history. Please
          try again.
        </div>

        <a
          href={`/student/billing?month=${encodeURIComponent(month)}`}
          className="inline-flex rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white"
        >
          Try again
        </a>
      </section>
    );
  }

  const report = data as MonthlyRebates;

  return (
    <section className="kt-finance">
      <header>
        <p className="kt-eyebrow">
          Your meal account
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <h1>Thoughtful choices. Clear credits.</h1>

          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium text-white">
            {formatMonth(month)}
          </span>
        </div>

        <p className="mt-3 text-sm">
          Track your cancellation credits and
          re-enrollment reversals, all in one place.
        </p>
      </header>

      <form
        action="/student/billing"
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <div className="space-y-2">
          <label
            htmlFor="rebate-month"
            className="block text-xs font-semibold text-[#496557]"
          >
            Meal month
          </label>

          <input
            key={month}
            id="rebate-month"
            name="month"
            type="month"
            min="2000-01"
            max="2099-12"
            defaultValue={month}
            required
            className="px-3 text-sm"
          />
        </div>

        <button
          type="submit"
          className="bg-[#087A68] px-5 text-sm font-semibold text-white hover:bg-[#066454]"
        >
          View history
        </button>

        <p className="w-full text-xs leading-5 text-[#647A71] lg:ml-auto lg:w-auto">
          Credits are grouped by the meal’s serving month.
        </p>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="kt-stat kt-stat-feature">
          <p className="kt-stat-label">
            Net rebate
          </p>
          <p className="kt-stat-value">
            {formatPaise(report.net_rebate_paise)}
          </p>
          <p className="kt-stat-note">
            Credit remaining after reversals
          </p>
        </div>

        <div className="kt-stat">
          <p className="kt-stat-label">
            Credits earned
          </p>
          <p className="kt-stat-value">
            {formatPaise(report.total_credit_paise)}
          </p>
          <p className="kt-stat-note">
            Eligible cancellations before cutoff
          </p>
        </div>

        <div className="kt-stat">
          <p className="kt-stat-label">
            Credits reversed
          </p>
          <p className="kt-stat-value">
            {formatPaise(report.total_reversal_paise)}
          </p>
          <p className="kt-stat-note">
            Credits removed after re-enrollment
          </p>
        </div>

        <div className="kt-stat">
          <p className="kt-stat-label">
            Transactions
          </p>
          <p className="kt-stat-value">
            {report.transaction_count}
          </p>
          <p className="kt-stat-note">
            Recorded credit and reversal entries
          </p>
        </div>
      </div>

      <section
        className="kt-panel"
        aria-labelledby="rebate-history-heading"
      >
        <div className="kt-panel-heading">
          <div>
            <h2 id="rebate-history-heading">
              Rebate activity
            </h2>
            <p>
              Every credit and reversal has its own record.
            </p>
          </div>

          <span className="kt-count-badge">
            {report.transaction_count} entries
          </span>
        </div>

        {report.transactions.length === 0 ? (
          <div className="kt-empty">
            <div
              aria-hidden="true"
              className="kt-empty-symbol"
            >
              +
            </div>

            <h3 className="font-semibold text-[#163E34]">
              No rebate activity yet
            </h3>

            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#647A71]">
              When you cancel an enrolled meal before
              cutoff, its eligible credit will appear here.
            </p>
          </div>
        ) : (
          <ul aria-label="Rebate transactions">
            {report.transactions.map((transaction) => {
              const isCredit =
                transaction.kind === "CREDIT";

              return (
                <li
                  key={transaction.id}
                  className="kt-history-row"
                >
                  <div
                    aria-hidden="true"
                    className={[
                      "kt-event-icon",
                      isCredit
                        ? "kt-event-credit"
                        : "kt-event-reversal",
                    ].join(" ")}
                  >
                    {isCredit ? "+" : "↶"}
                  </div>

                  <div className="min-w-0">
                    <p className="kt-entry-title">
                      {mealLabel(transaction.meal_type)}
                      {" · "}
                      {formatMealDate(
                        transaction.meal_date,
                      )}
                    </p>

                    <p className="kt-entry-menu">
                      {transaction.menu}
                    </p>

                    <p className="kt-entry-meta">
                      {isCredit
                        ? "Meal cancelled before cutoff"
                        : "Credit reversed after re-enrollment"}
                      <br />
                      Recorded{" "}
                      <time
                        dateTime={transaction.created_at}
                      >
                        {formatRecordedAt(
                          transaction.created_at,
                        )}
                      </time>
                      {" IST"}
                    </p>
                  </div>

                  <div className="kt-entry-summary text-right">
                    <p
                      className={[
                        "kt-entry-amount",
                        isCredit
                          ? "text-[#08634C]"
                          : "text-[#965112]",
                      ].join(" ")}
                    >
                      {isCredit ? "+" : ""}
                      {formatPaise(
                        transaction.delta_paise,
                      )}
                    </p>

                    <span
                      className={[
                        "kt-entry-badge",
                        isCredit
                          ? "kt-event-credit"
                          : "kt-event-reversal",
                      ].join(" ")}
                    >
                      {isCredit
                        ? "Credit added"
                        : "Credit reversed"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="kt-panel-footer">
          {report.transaction_count >
          report.transactions.length
            ? `Showing the latest ${report.transactions.length} entries. Summary totals include every transaction for this meal month.`
            : "Summary totals include every transaction for the selected meal month."}
        </div>
      </section>

      <aside className="kt-finance-note">
        <strong>How your rebate works:</strong>{" "}
        Cancelling an enrolled meal before cutoff adds
        credit. Joining it again reverses that credit.
        These credits reduce your meal bill; they are
        not cash refunds.
      </aside>
    </section>
  );
}

export default function RebateHistoryPage(
  props: PageProps,
) {
  return (
    <Suspense
      fallback={
        <div className="kt-finance">
          <div
            role="status"
            className="kt-panel p-6 text-sm text-[#526D64]"
          >
            Loading your rebate history…
          </div>
        </div>
      }
    >
      <RebateContent {...props} />
    </Suspense>
  );
}