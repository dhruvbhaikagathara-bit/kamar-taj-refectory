import { Suspense } from "react";
import { requireRole } from "@/lib/auth/require-role";
import { DashboardLogoutButton } from "@/components/dashboard-logout-button";

async function ScannerDashboard() {
  const { user, profile } = await requireRole("SCANNER_STAFF");

  return (
    <main className="min-h-screen bg-[#FAFCFC] px-6 py-12 text-[#152D33]">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="flex justify-end">
          <DashboardLogoutButton />
        </div>

        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#087A68]">
            Kamar-Taj Refectory
          </p>

          <h1 className="mt-3 text-3xl font-bold">
            Meal check-in
          </h1>

          <p className="mt-2 text-slate-600">
            Welcome, {profile.full_name || "Scanner Staff"}
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Your account</h2>

          <dl className="mt-5 space-y-4">
            <div>
              <dt className="text-sm text-slate-500">Email</dt>
              <dd className="break-all font-medium">{user.email}</dd>
            </div>

            <div>
              <dt className="text-sm text-slate-500">Role</dt>
              <dd className="font-medium">{profile.role}</dd>
            </div>

            <div>
              <dt className="text-sm text-slate-500">Account status</dt>
              <dd className="font-medium text-[#087A68]">
                {profile.account_status}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border-2 border-dashed border-[#087A68] bg-[#EFF5F7] p-8 text-center">
          <h2 className="text-xl font-semibold">QR scanner</h2>

          <p className="mt-3 text-slate-600">
            Camera scanning and meal verification are not available yet.
          </p>
        </section>
      </div>
    </main>
  );
}

export default function ScannerPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading scanner page...</p>}>
      <ScannerDashboard />
    </Suspense>
  );
}