import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_NAME } from "@/lib/constants";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Sign in to {APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">No password needed. We&apos;ll email you a code.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-28" />}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : null} />;
}
