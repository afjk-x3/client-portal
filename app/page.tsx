import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { getUser, homePath } from "@/lib/auth";

// Blocks at request time: the auth check reads cookies, which cannot sit in a static shell.
export const instant = false;

export default async function LandingPage() {
  // Authed visitors leave at once, so browser Back after signing in never
  // returns to a public page.
  if (await getUser()) redirect(await homePath());
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-6">
      <p className="text-sm font-medium text-muted-foreground">{APP_NAME}</p>
      <h1 className="text-4xl font-semibold tracking-tight">Stop chasing client documents by email.</h1>
      <p className="text-lg text-muted-foreground">
        Send each client a checklist. They upload files and answer questions from any phone, with no password.
        You review each item, and reminders go out on their own.
      </p>
      <div>
        <Button asChild size="lg">
          <Link href="/login">Get started</Link>
        </Button>
      </div>
    </main>
  );
}
