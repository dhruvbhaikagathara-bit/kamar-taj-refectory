import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  CalendarDays,
  Leaf,
  QrCode,
  ReceiptText,
} from "lucide-react";

import { AuthButton } from "@/components/auth-button";
import { EnvVarWarning } from "@/components/env-var-warning";
import { hasEnvVars } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Kamar-Taj Refectory",
  description:
    "Plan meals, manage choices, and reduce food waste with Kamar-Taj Refectory.",
};

const features = [
  {
    title: "Plan your meals",
    description:
      "View the menu and update your choices before the cutoff.",
    icon: CalendarDays,
    color: "bg-[#E4F4EB] text-[#087A68]",
  },
  {
    title: "A simple meal pass",
    description:
      "Open your QR pass when it’s time to collect your meal.",
    icon: QrCode,
    color: "bg-[#EAF3F7] text-[#477A91]",
  },
  {
    title: "Track your rebates",
    description:
      "Review your meal charges and eligible rebate history.",
    icon: ReceiptText,
    color: "bg-[#FFF0E3] text-[#AD5D21]",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#FAFCFC] text-[#152D33]">
      <header className="border-b border-[#E1EAE6] bg-white">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"
        >
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68]"
          >
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#103C39] text-lg font-bold text-white"
            >
              K
            </span>

            <span>
              <span className="block text-base font-bold leading-tight text-[#103C39]">
                Kamar-Taj
              </span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Refectory
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense
                fallback={
                  <span className="text-sm text-slate-500">
                    Loading account…
                  </span>
                }
              >
                <AuthButton />
              </Suspense>
            )}
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="relative overflow-hidden rounded-3xl bg-[#103C39] px-6 py-12 text-white sm:px-10 sm:py-16 lg:px-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full border border-white/10"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-8 h-64 w-64 rounded-full border border-white/10"
          />

          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-100/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.13em] text-emerald-50">
              <Leaf size={14} aria-hidden="true" />
              A smarter way to dine
            </span>

            <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              Good food.
              <br />
              Less waste.
              <br />
              <span className="text-[#BDE8D0]">
                Better planning.
              </span>
            </h1>

            <p className="mt-5 max-w-lg text-base leading-7 text-emerald-50/85">
              Welcome to Kamar-Taj Refectory. Plan your
              meals, collect them with your meal pass, and
              help the kitchen prepare with confidence.
            </p>

            <p className="mt-7 text-sm leading-6 text-emerald-100/80">
              Use the sign-in button above to open your
              student, kitchen, or scanner workspace.
            </p>

            <Link
  href="/admin"
  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#103C39] transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#103C39]"
>
  Open workspace
  <ArrowRight size={16} aria-hidden="true" />
</Link>
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="features-heading"
          className="scroll-mt-6 py-12 sm:py-16"
        >
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#087A68]">
              Everyday dining, simplified
            </p>

            <h2
              id="features-heading"
              className="mt-3 text-3xl font-bold tracking-tight text-[#103C39]"
            >
              Everything you need for your next meal.
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
              Make your choice, check your meal pass, and
              keep track of your account in one place.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <article
                  key={feature.title}
                  className="rounded-2xl border border-[#E1EAE6] bg-white p-6 shadow-sm"
                >
                  <span
                    className={`inline-flex rounded-xl p-3 ${feature.color}`}
                  >
                    <Icon size={22} aria-hidden="true" />
                  </span>

                  <h3 className="mt-5 text-lg font-bold text-[#103C39]">
                    {feature.title}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-[#DCEBE2] bg-[#EAF6EF] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="text-xl font-bold text-[#103C39]">
              Every meal matters.
            </h2>

            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
              Thoughtful meal choices help the kitchen
              plan ahead and reduce unnecessary food waste.
            </p>
          </div>

          <a
            href="#top"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-[#087A68] px-5 py-3 text-sm font-semibold text-white hover:bg-[#066454] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A68] focus-visible:ring-offset-2"
          >
            Back to sign in
          </a>
        </section>
      </div>

      <footer className="border-t border-[#E1EAE6] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-slate-500 sm:px-6">
          <p className="font-semibold text-[#103C39]">
            Kamar-Taj Refectory
          </p>
          <p>Plan ahead. Make every meal count.</p>
        </div>
      </footer>
    </main>
  );
}