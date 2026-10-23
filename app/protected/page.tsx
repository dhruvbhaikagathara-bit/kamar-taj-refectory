import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";

async function DashboardRedirect() {
  const { homePage } = await requireRole();

 return redirect(homePage);
}

export default function ProtectedPage() {
  return (
    <Suspense
      fallback={<p className="p-8">Opening your dashboard...</p>}
    >
      <DashboardRedirect />
    </Suspense>
  );
}