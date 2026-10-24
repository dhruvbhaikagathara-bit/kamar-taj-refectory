import { Suspense, type ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600">
          Loading admin dashboard…
        </div>
      }
    >
      <DashboardShell role="ADMIN">
        {children}
      </DashboardShell>
    </Suspense>
  );
}