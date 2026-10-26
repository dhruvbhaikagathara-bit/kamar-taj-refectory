import { Suspense } from "react";
import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  formatPaise,
  getCurrentBillingMonth,
  isBillingMonth,
} from "@/lib/billing";
import type { MonthlyBill } from "@/lib/billing-statement";

type PageProps = {
  searchParams: Promise<{
    month?: string | string[];
  }>;
};

function formatMealDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}-01T00:00:00Z`));
}

function mealLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

async function StatementContent({
  searchParams,
}: PageProps) {
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
          <p className="kt-eyebrow">
            Your monthly statement
          </p>

          <h1>Choose a valid month</h1>

          <p className="mt-3 text-sm">
            Select a billing month using the YYYY-MM format.
          </p>
        </header>

        <Link
          href="/student/billing/statement"
          className="inline-flex rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white hover:bg-[#066454]"
        >
          Open current month
        </Link>
      </section>
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_my_monthly_bill",
    { p_month: month },
  );

  if (error || !data) {
    const needsReview =
      error?.message.includes(
        "BILLING_RECONCILIATION_REQUIRED",
      ) ?? false;

    return (
      <section className="kt-finance">
        <header>
          <p className="kt-eyebrow">
            Your monthly statement
          </p>

          <h1>Monthly meal bill</h1>

          <p className="mt-3 text-sm">
            {formatMonth(month)}
          </p>
        </header>

        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm leading-6 text-red-800"
        >
          {needsReview
            ? "Your billing records need an administrator’s review. We cannot display a reliable total yet."
            : "We could not load your monthly bill. Please try again."}
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href={`/student/billing/statement?month=${encodeURIComponent(month)}`}
            className="inline-flex rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white hover:bg-[#066454]"
          >
            Try again
          </a>

          <Link
            href={`/student/billing?month=${encodeURIComponent(month)}`}
            className="inline-flex rounded-xl border border-[#CFDDD6] bg-white px-5 py-3 text-sm font-semibold text-[#103C39] hover:bg-[#EDF5EF]"
          >
            View rebate history
          </Link>
        </div>
      </section>
    );
  }

  const bill = data as MonthlyBill;

  return (
    <section className="kt-finance">
      <header>
        <p className="kt-eyebrow">
          Your monthly statement
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <h1>Monthly meal bill</h1>

          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium text-white">
            Live summary
          </span>
        </div>

        <p className="mt-3 text-sm">
          {formatMonth(month)} · Your meals, credits, and
          calculated charges in one clear statement.
        </p>
      </header>

      <form
        action="/student/billing/statement"
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <div className="space-y-2">
          <label
            htmlFor="billing-month"
            className="block text-xs font-semibold text-[#496557]"
          >
            Billing month
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
            className="px-3 text-sm"
          />
        </div>

        <button
          type="submit"
          className="bg-[#087A68] px-5 text-sm font-semibold text-white hover:bg-[#066454]"
        >
          View bill
        </button>

        <p className="w-full text-xs leading-5 text-[#647A71] lg:ml-auto lg:w-auto">
          Charges are grouped by the meal’s serving month.
        </p>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="kt-stat">
          <p className="kt-stat-label">
            Base charges
          </p>

          <p className="kt-stat-value">
            {formatPaise(bill.base_charges_paise)}
          </p>

          <p className="kt-stat-note">
            {bill.charged_meal_count} recorded meal charges
          </p>
        </div>

        <div className="kt-stat">
          <p className="kt-stat-label">
            Net rebates
          </p>

          <p className="kt-stat-value">
            {formatPaise(bill.net_rebate_paise)}
          </p>

          <p className="kt-stat-note">
            Cancellation credits minus reversals
          </p>
        </div>

        <div className="kt-stat kt-stat-feature">
          <p className="kt-stat-label">
            Calculated amount due
          </p>

          <p className="kt-stat-value">
            {formatPaise(bill.amount_due_paise)}
          </p>

          <p className="kt-stat-note">
            Base charges − net rebates
          </p>
        </div>
      </div>

      <section
        className="kt-panel"
        aria-labelledby="meal-breakdown-heading"
      >
        <div className="kt-panel-heading">
          <div>
            <h2 id="meal-breakdown-heading">
              Meal breakdown
            </h2>

            <p>
              One base charge per meal, with every rebate
              accounted for.
            </p>
          </div>

          <span className="kt-count-badge">
            {bill.charged_meal_count} meals
          </span>
        </div>

        {bill.items.length === 0 ? (
          <div className="kt-empty">
            <div
              aria-hidden="true"
              className="kt-empty-symbol"
            >
              ₹
            </div>

            <h3 className="font-semibold text-[#163E34]">
              No meal charges this month
            </h3>

            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#647A71]">
              A charge is recorded when you first opt in
              to a meal. Your booked meals will appear here.
            </p>
          </div>
        ) : (
          <div
            role="region"
            aria-label="Monthly meal charges"
            tabIndex={0}
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#087A68]"
          >
            <table className="w-full min-w-[680px] text-sm">
              <caption className="sr-only">
                Meal charges, rebates, and amounts due for{" "}
                {formatMonth(month)}
              </caption>

              <thead>
                <tr className="border-b border-[#DCE7E2]">
                  <th
                    scope="col"
                    className="px-5 py-4 text-left font-semibold"
                  >
                    Meal
                  </th>

                  <th
                    scope="col"
                    className="px-5 py-4 text-right font-semibold"
                  >
                    Base charge
                  </th>

                  <th
                    scope="col"
                    className="px-5 py-4 text-right font-semibold"
                  >
                    Net rebate
                  </th>

                  <th
                    scope="col"
                    className="px-5 py-4 text-right font-semibold"
                  >
                    Amount due
                  </th>
                </tr>
              </thead>

              <tbody>
                {bill.items.map((item) => (
                  <tr
                    key={item.charge_id}
                    className="border-b last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="px-5 py-5 text-left font-normal"
                    >
                      <p className="font-semibold text-[#163E34]">
                        {mealLabel(item.meal_type)}
                      </p>

                      <p className="mt-1 text-xs text-[#647A71]">
                        {formatMealDate(item.meal_date)}
                      </p>

                      <p className="mt-2 max-w-sm whitespace-pre-wrap break-words text-xs leading-5 text-[#526D64]">
                        {item.menu}
                      </p>

                      {item.origin ===
                        "OPENING_SNAPSHOT" && (
                        <span className="mt-2 inline-block rounded-full bg-[#FFF2DF] px-2.5 py-1 text-[10px] font-semibold text-[#965112]">
                          Opening charge
                        </span>
                      )}
                    </th>

                    <td className="whitespace-nowrap px-5 py-5 text-right tabular-nums text-[#31594D]">
                      {formatPaise(
                        item.base_charge_paise,
                      )}
                    </td>

                    <td className="whitespace-nowrap px-5 py-5 text-right font-medium tabular-nums text-[#087A68]">
                      {formatPaise(
                        item.net_rebate_paise,
                      )}
                    </td>

                    <td className="whitespace-nowrap px-5 py-5 text-right font-bold tabular-nums text-[#163E34]">
                      {formatPaise(
                        item.amount_due_paise,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot className="border-t border-[#DCE7E2] font-semibold">
                <tr>
                  <th
                    scope="row"
                    className="px-5 py-5 text-left"
                  >
                    Monthly total
                  </th>

                  <td className="whitespace-nowrap px-5 py-5 text-right tabular-nums">
                    {formatPaise(
                      bill.base_charges_paise,
                    )}
                  </td>

                  <td className="whitespace-nowrap px-5 py-5 text-right tabular-nums text-[#087A68]">
                    {formatPaise(
                      bill.net_rebate_paise,
                    )}
                  </td>

                  <td className="whitespace-nowrap px-5 py-5 text-right text-base font-bold tabular-nums text-[#163E34]">
                    {formatPaise(
                      bill.amount_due_paise,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="kt-panel-footer">
          Cancelling before cutoff adds a rebate. Opting
          back in reverses it without adding a second
          base charge.
        </div>
      </section>

      {bill.opening_snapshot_count > 0 && (
        <aside className="rounded-2xl border border-[#F0D9B3] bg-[#FFF8EC] p-5 text-xs leading-6 text-[#80531D]">
          <strong>
            About your {bill.opening_snapshot_count} opening
            charges:
          </strong>{" "}
          These existing meal records were imported using
          the prices saved when billing was enabled.
          Original booking-time prices were not recorded.
        </aside>
      )}

      {bill.uncharged_opted_out_count > 0 && (
        <p className="text-xs leading-6 text-[#647A71]">
          {bill.uncharged_opted_out_count} opted-out meal
          choices have no recorded base charge and are
          excluded from this bill.
        </p>
      )}

      <aside className="kt-finance-note">
        <p>
          <strong>About this statement:</strong>{" "}
          Meals belong to the month of their serving date.
          Future booked meals in that month are included.
        </p>

        <p className="mt-2">
          This is a live calculation, not a finalized
          invoice. Payments are not tracked here, and
          rebates are billing credits rather than cash
          refunds.
        </p>
      </aside>
    </section>
  );
}

export default function MonthlyStatementPage(
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
            Loading your monthly bill…
          </div>
        </div>
      }
    >
      <StatementContent {...props} />
    </Suspense>
  );
}