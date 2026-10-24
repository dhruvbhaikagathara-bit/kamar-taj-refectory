import { Suspense, type ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";

export default function StaffLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600">
          Loading scanner dashboard…
        </div>
      }
    >
      <DashboardShell role="SCANNER_STAFF">
        {children}
      </DashboardShell>
    </Suspense>
  );
}