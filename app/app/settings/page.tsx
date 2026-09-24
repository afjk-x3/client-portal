import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FirmNameForm } from "./firm-name-form";
import { Team } from "./team";

export default function SettingsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: firm }, { data: members }] = await Promise.all([
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
    supabase.from("firm_members").select("user_id, full_name, email, role").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  const isAdmin = staff.role === "admin";

  return (
    <>
      <FirmNameForm name={firm?.name ?? ""} editable={isAdmin} />
      <Team
        currentUserId={staff.userId}
        isAdmin={isAdmin}
        members={(members ?? []).map((m) => ({
          userId: m.user_id,
          fullName: m.full_name,
          email: m.email,
          role: m.role === "admin" ? "admin" : "staff",
        }))}
      />
    </>
  );
}
