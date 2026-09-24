"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function StaffError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">Try again. If it keeps happening, contact support.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
