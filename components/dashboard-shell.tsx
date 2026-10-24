"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Role = "STUDENT" | "ADMIN" | "SCANNER_STAFF";

type NavigationItem = {
  label: string;
  href: string;
};

const navigation: Record<Role, NavigationItem[]> = {
  STUDENT: [
    { label: "My meals", href: "/student" },
  ],
  ADMIN: [
    { label: "Kitchen overview", href: "/admin" },
    { label: "Create meal", href: "/admin/meals" },
  ],
  SCANNER_STAFF: [
    { label: "Meal scanner", href: "/staff/scan" },
  ],
};

const roleLabels: Record<Role, string> = {
  STUDENT: "Student portal",
  ADMIN: "Kitchen administration",
  SCANNER_STAFF: "Scanner staff",
};

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
      const active = pathname === item.href;

      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={[
            "flex min-h-12 items-center rounded-xl px-4 py-3",
            "text-sm font-semibold transition-colors",
            "focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-emerald-400",
            mobile ? "justify-center text-center" : "",
            active
              ? "bg-[#087A68] text-white"
              : mobile
                ? "text-[#152D33] hover:bg-[#EFF5F7]"
                : "text-slate-200 hover:bg-white/10",
          ].join(" ")}
        >
          {item.label}
        </Link>
      );
    });
  }

  return (
    <div className="min-h-screen w-full bg-[#FAFCFC] text-[#152D33]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-[#103C39] p-6 text-white md:flex">
        <Link
          href={items[0].href}
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span className="block text-2xl font-bold">
            Kamar-Taj
          </span>
          <span className="mt-1 block text-sm text-emerald-100">
            Refectory
          </span>
        </Link>

        <p className="mt-8 text-xs font-semibold uppercase tracking-wider text-emerald-200">
          {roleLabels[role]}
        </p>

        <nav
          aria-label="Dashboard navigation"
          className="mt-4 flex flex-col gap-2"
        >
          {renderLinks(false)}
        </nav>

        <p className="mt-auto pt-8 text-xs leading-5 text-emerald-100">
          Plan your meals. Help reduce food waste.
        </p>
      </aside>

      {/* Mobile header */}
      <header className="border-b border-slate-200 bg-white px-4 py-4 md:hidden">
        <Link href={items[0].href} className="text-lg font-bold">
          Kamar-Taj Refectory
        </Link>
        <p className="mt-1 text-xs text-slate-600">
          {roleLabels[role]}
        </p>
      </header>

      {/* Space for the sidebar and mobile bottom bar */}
      <div className="min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] md:ml-64 md:pb-0">
        {children}
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Mobile dashboard navigation"
        className="fixed inset-x-0 bottom-0 z-50 grid auto-cols-fr grid-flow-col gap-2 border-t border-slate-200 bg-white px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg md:hidden"
      >
        {renderLinks(true)}
      </nav>
    </div>
  );
}