import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Role = "STUDENT" | "ADMIN" | "SCANNER_STAFF";

const homeByRole: Record<Role, string> = {
  STUDENT: "/student",
  ADMIN: "/admin",
  SCANNER_STAFF: "/staff/scan",
};

export async function requireRole(requiredRole?: Role) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, account_status")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unable to load your user profile.");
  }

  if (profile.account_status !== "ACTIVE") {
    throw new Error(
      "Your account is inactive. Contact the administrator."
    );
  }

  const role = profile.role;

  if (
    role !== "STUDENT" &&
    role !== "ADMIN" &&
    role !== "SCANNER_STAFF"
  ) {
    throw new Error("Your account has an unsupported role.");
  }

  const homePage = homeByRole[role as Role];

  if (requiredRole && role !== requiredRole) {
    redirect(homePage);
  }

  return { user, profile, homePage };
}