"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Catches what no nested boundary does, including errors thrown by a
 * segment's own layout, such as the staff shell in app/app/layout.tsx.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-start gap-4 p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">Try again. If it keeps happening, contact support.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
