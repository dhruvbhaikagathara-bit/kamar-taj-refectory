import Link from "next/link";
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

function formatMealDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatTransactionTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function BillingContent({ searchParams }: PageProps) {
  await requireRole("STUDENT");

  const params = await searchParams;

  const month =
    params.month === undefined
      ? getCurrentBillingMonth()
      : typeof params.month === "string"
        ? params.month
        : "";

  if (!isBillingMonth(month)) {
    return (
      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <h1 className="text-2xl font-bold">Invalid month</h1>

        <p>Choose a month between January 2000 and December 2099.</p>

        <Link
          href="/student/billing"
          className="font-medium text-[#087A68] underline"
        >
          Open this month’s rebates
        </Link>
      </main>
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_my_monthly_rebates",
    { p_month: month },
  );

  const report = data as MonthlyRebates | null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <Link
          href="/student"
          className="text-sm font-medium text-[#087A68] underline"
        >
          ← Back to my meals
        </Link>

        <h1 className="text-3xl font-bold text-[#103C39]">
          My meal rebates
        </h1>

        <p className="text-sm text-slate-600">
          See cancellation credits and re-enrollment reversals.
          Transactions are grouped by the meal’s date.
        </p>
      </header>

      <form
        action="/student/billing"
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"
      >
        <div className="space-y-1">
          <label
            htmlFor="billing-month"
            className="block text-sm font-medium"
          >
            Meal month
          </label>

          <input
            key={month}
            id="billing-month"
            name="month"
            type="month"
            min="2000-01"
            max="2099-12"
            defaultValue={month}
            required
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
          />
        </div>

        <button
          type="submit"
          className="rounded-lg bg-[#087A68] px-4 py-2 font-medium text-white hover:bg-[#066452] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087A68]"
        >
          View month
        </button>
      </form>

      {error || !report ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
        >
          Unable to load your rebates. Please refresh and try again.
        </div>
      ) : (
        <>
          <section
            aria-label="Monthly rebate totals"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {[
              {
                label: "Net rebate",
                value: formatPaise(report.net_rebate_paise),
              },
              {
                label: "Credits earned",
                value: formatPaise(report.total_credit_paise),
              },
              {
                label: "Credits reversed",
                value: formatPaise(report.total_reversal_paise),
              },
              {
                label: "Transactions",
                value: report.transaction_count.toLocaleString("en-IN"),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border bg-white p-5"
              >
                <p className="text-sm text-slate-600">
                  {item.label}
                </p>

                <p className="mt-2 break-words text-2xl font-bold text-[#103C39]">
                  {item.value}
                </p>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b p-4">
              <h2 className="text-lg font-semibold text-[#103C39]">
                Transaction history
              </h2>

              <p className="mt-1 text-sm text-slate-600">
                Credit increases your rebate. Reversal removes a
                previously issued credit when you rejoin a meal.
              </p>
            </div>

            {report.transactions.length === 0 ? (
              <div className="space-y-2 p-8 text-center">
                <p className="font-medium text-slate-800">
                  No rebate transactions for this month.
                </p>

                <p className="text-sm text-slate-600">
                  Cancel an enrolled meal before its cutoff to earn
                  an eligible rebate.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <caption className="sr-only">
                    Meal rebate transactions for {month}
                  </caption>

                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Meal
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Entry
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Recorded · IST
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-right"
                      >
                        Amount
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.transactions.map((transaction) => (
                      <tr
                        key={transaction.id}
                        className="border-t align-top"
                      >
                        <td className="px-4 py-4">
                          <p className="font-medium text-slate-900">
                            {formatMealDate(transaction.meal_date)}
                            {" · "}
                            {transaction.meal_type}
                          </p>

                          <p className="mt-1 max-w-xs break-words text-slate-600">
                            {transaction.menu}
                          </p>
                        </td>

                        <td className="px-4 py-4">
                          <span
                            className={
                              transaction.kind === "CREDIT"
                                ? "rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-800"
                                : "rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-900"
                            }
                          >
                            {transaction.kind === "CREDIT"
                              ? "Credit"
                              : "Reversal"}
                          </span>
                        </td>

                        <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                          {formatTransactionTime(
                            transaction.created_at,
                          )}
                        </td>

                        <td className="whitespace-nowrap px-4 py-4 text-right font-semibold">
                          {transaction.kind === "CREDIT" ? "+" : ""}
                          {formatPaise(transaction.delta_paise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.transaction_count > report.transactions.length && (
              <p className="border-t p-4 text-sm text-slate-600">
                Showing the latest {report.transactions.length} entries.
                Monthly totals include all {report.transaction_count} transactions.
              </p>
            )}
          </section>

          <p className="text-sm text-slate-600">
            These amounts are meal billing credits. They are not cash
            payouts or a payable bill.
          </p>
        </>
      )}
    </main>
  );
}

export default function BillingPage(props: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600">
          Loading your rebates…
        </div>
      }
    >
      <BillingContent {...props} />
    </Suspense>
  );
}