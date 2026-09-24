import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { getStaff } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Set up your firm</h1>
        <p className="text-sm text-muted-foreground">We&apos;ll add a starter checklist you can edit.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-40" />}>
        <Onboarding />
      </Suspense>
    </main>
  );
}

async function Onboarding() {
  if (await getStaff()) redirect("/app");
  return <OnboardingForm />;
}
