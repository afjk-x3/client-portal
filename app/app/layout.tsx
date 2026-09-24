import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffShell } from "./staff-shell";

export default function StaffLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96" />}>
      <StaffShell>{children}</StaffShell>
    </Suspense>
  );
}
