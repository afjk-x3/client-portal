import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "./app-sidebar";

/** Sends non-staff away, then renders the sidebar layout. */
export async function StaffShell({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: firm } = await supabase.from("firms").select("name").eq("id", staff.firmId).single();

  return (
    <SidebarProvider>
      <AppSidebar firmName={firm?.name ?? ""} userName={staff.fullName} />
      <SidebarInset>
        <header className="flex h-12 items-center border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
