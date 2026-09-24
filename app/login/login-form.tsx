"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { signInDestination } from "./actions";

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    startTransition(async () => {
      const { error } = await createClient().auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setEmail(address);
      toast.success("Check your email for a 6-digit code.");
    });
  }

  function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    const token = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    startTransition(async () => {
      const { error } = await createClient().auth.verifyOtp({ email, token, type: "email" });
      if (error) {
        toast.error("That code is wrong or has expired. Try again or request a new code.");
        return;
      }
      router.replace(await signInDestination(next));
    });
  }

  if (!email) {
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send code"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        We sent a 6-digit code to <strong>{email}</strong>.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEmail(null)} disabled={pending}>
        Use a different email
      </Button>
    </form>
  );
}
