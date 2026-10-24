import { Suspense, type ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard-shell";

export default function StudentLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-600">
          Loading student dashboard…
        </div>
      }
    >
      <DashboardShell role="STUDENT">
        {children}
      </DashboardShell>
    </Suspense>
  );
}