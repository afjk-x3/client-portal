import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/auth";
import { timeZoneNames } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { FirmNameForm } from "./firm-name-form";
import { LeaveFirm } from "./leave-firm";
import { Team } from "./team";
import { TimeZoneForm } from "./time-zone-form";

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
  const [firm, members] = await Promise.all([
    supabase.from("firms").select("name, time_zone").eq("id", staff.firmId).single(),
    supabase.from("firm_members").select("user_id, full_name, email, role").eq("firm_id", staff.firmId).order("full_name"),
  ]);
  if (firm.error) throw firm.error;
  if (members.error) throw members.error;
  const isAdmin = staff.role === "admin";
  const zones = timeZoneNames();
  if (!zones.includes(firm.data.time_zone)) zones.unshift(firm.data.time_zone);
  const regions = [...Map.groupBy(zones, (zone) => zone.split("/")[0])].map(([region, names]) => ({ region, names }));

  return (
    <>
      <FirmNameForm name={firm.data.name} editable={isAdmin} />
      <TimeZoneForm timeZone={firm.data.time_zone} regions={regions} editable={isAdmin} />
      <Team
        currentUserId={staff.userId}
        isAdmin={isAdmin}
        members={members.data.map((m) => ({
          userId: m.user_id,
          fullName: m.full_name,
          email: m.email,
          role: m.role === "admin" ? "admin" : "staff",
        }))}
      />
      {!isAdmin && <LeaveFirm firmName={firm.data.name} />}
    </>
  );
}
