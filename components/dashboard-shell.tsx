"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Role = "STUDENT" | "ADMIN" | "SCANNER_STAFF";

type IconName =
  | "meals"
  | "qr"
  | "rebates"
  | "bill"
  | "overview"
  | "add"
  | "edit"
  | "scan";

type NavigationItem = {
  label: string;
  mobileLabel: string;
  href: string;
  icon: IconName;
};

const navigation: Record<Role, NavigationItem[]> = {
  STUDENT: [
    {
      label: "My meals",
      mobileLabel: "Meals",
      href: "/student",
      icon: "meals",
    },
    {
      label: "Meal QR",
      mobileLabel: "Meal QR",
      href: "/student/qr",
      icon: "qr",
    },
    {
      label: "Rebate history",
      mobileLabel: "Rebates",
      href: "/student/billing",
      icon: "rebates",
    },
    {
      label: "Monthly bill",
      mobileLabel: "Bill",
      href: "/student/billing/statement",
      icon: "bill",
    },
  ],
    ADMIN: [
    {
      label: "Kitchen overview",
      mobileLabel: "Overview",
      href: "/admin",
      icon: "overview",
    },
    {
      label: "Create meal",
      mobileLabel: "Create",
      href: "/admin/meals",
      icon: "add",
    },
    {
      label: "Edit menu",
      mobileLabel: "Edit",
      href: "/admin/meals/edit",
      icon: "edit",
    },
    {
      label: "Meal analytics",
      mobileLabel: "Analytics",
      href: "/admin/analytics",
      icon: "overview",
    },
  ],
  SCANNER_STAFF: [
    {
      label: "Meal scanner",
      mobileLabel: "Scanner",
      href: "/staff/scan",
      icon: "scan",
    },
  ],
};

const roleLabels: Record<Role, string> = {
  STUDENT: "Student portal",
  ADMIN: "Kitchen administration",
  SCANNER_STAFF: "Scanner staff",
};

function NavigationIcon({ name }: { name: IconName }) {
  const drawings: Record<IconName, ReactNode> = {
    meals: (
      <>
        <path d="M5 3v6M8 3v6M11 3v6M5 7h6M8 9v12" />
        <path d="M19 21V3c-3 2-4 5-4 9h4" />
      </>
    ),
    qr: (
      <>
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="15" y="3" width="6" height="6" rx="1" />
        <rect x="3" y="15" width="6" height="6" rx="1" />
        <path d="M15 15h3v3h3M15 21h3M21 12v3M12 3v3" />
      </>
    ),
    rebates: (
      <>
        <path d="M3 8h16a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h12v3" />
        <path d="M21 12h-5v4h5" />
        <path d="M17 14h.01" />
      </>
    ),
    bill: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 7h6M9 11h6M9 15h3" />
      </>
    ),
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    add: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
    edit: (
      <>
        <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" />
        <path d="M13 20h7" />
      </>
    ),
    scan: (
      <>
        <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M3 12h18" />
      </>
    ),
  };

  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {drawings[name]}
    </svg>
  );
}

type DashboardShellProps = {
  role: Role;
  children: ReactNode;
};

export function DashboardShell({
  role,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const items = navigation[role];

  function renderLinks(mobile: boolean) {
    return items.map((item) => {
      // Exact matching prevents both billing links being highlighted.
      const active = pathname === item.href;

      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={[
            "group flex min-h-12 rounded-xl font-medium",
            "transition-colors focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-emerald-400",
            mobile
              ? "flex-col items-center justify-center gap-1 px-1 py-2 text-[11px]"
              : "items-center gap-3 px-4 py-3.5 text-sm",
            active
              ? mobile
                ? "bg-[#E7F5EF] text-[#086653]"
                : "bg-[#D7F3E5] text-[#103C39] shadow-sm"
              : mobile
                ? "text-slate-600 hover:bg-slate-100"
                : "text-emerald-50/80 hover:bg-white/10 hover:text-white",
          ].join(" ")}
        >
          <NavigationIcon name={item.icon} />

          <span>
            {mobile ? item.mobileLabel : item.label}
          </span>

          {active && !mobile && (
            <span
              aria-hidden="true"
              className="ml-auto h-1.5 w-1.5 rounded-full bg-[#087A68]"
            />
          )}
        </Link>
      );
    });
  }

  return (
    <div className="kt-dashboard min-h-screen w-full bg-[#F5F8F7] text-[#152D33]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/10 bg-[#103C39] p-5 text-white md:flex">
        <Link
          href={items[0].href}
          className="flex items-center gap-3 rounded-xl px-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100/20 bg-white/10">
            <svg
              width="25"
              height="25"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#D7F3E5"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>

          <span>
            <span className="block text-xl font-bold tracking-tight">
              Kamar-Taj
            </span>
            <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.25em] text-emerald-100/70">
              Refectory
            </span>
          </span>
        </Link>

        <div className="mx-2 mt-6 border-t border-white/10" />

        <p className="mb-3 mt-7 px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/60">
          {roleLabels[role]}
        </p>

        <nav
          aria-label="Dashboard navigation"
          className="flex flex-col gap-2"
        >
          {renderLinks(false)}
        </nav>

        <div className="mt-auto pt-8">
          <div className="rounded-2xl border border-emerald-100/15 bg-white/5 p-4">
            <p className="text-sm font-medium text-emerald-50">
              Every meal matters.
            </p>
            <p className="mt-2 text-xs leading-5 text-emerald-100/70">
              Plan ahead. Make thoughtful choices.
              Help your kitchen reduce food waste.
            </p>
          </div>
        </div>
      </aside>

      <header className="border-b border-[#DCE7E2] bg-white px-4 py-4 md:hidden">
        <Link
          href={items[0].href}
          className="text-lg font-bold tracking-tight text-[#103C39]"
        >
          Kamar-Taj Refectory
        </Link>
        <p className="mt-1 text-xs text-slate-500">
          {roleLabels[role]}
        </p>
      </header>

      <div className="min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] md:ml-64 md:pb-0">
        {children}
      </div>

      <nav
        aria-label="Mobile dashboard navigation"
        className="fixed inset-x-0 bottom-0 z-50 grid auto-cols-fr grid-flow-col gap-1 border-t border-[#DCE7E2] bg-white px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(16,60,57,0.06)] md:hidden"
      >
        {renderLinks(true)}
      </nav>
    </div>
  );
}