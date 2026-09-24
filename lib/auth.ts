import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Staff = {
  userId: string;
  email: string;
  firmId: string;
  role: "admin" | "staff";
  fullName: string;
};

/** The signed-in user, or null. Verifies the JWT. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;
  return { id: data.claims.sub, email: data.claims.email ?? "" };
});

/** The caller's staff membership, or null. A failed query throws, so it never reads as "not staff". */
export const getStaff = cache(async (): Promise<Staff | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("firm_members")
    .select("firm_id, role, full_name, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    userId: user.id,
    email: data.email,
    firmId: data.firm_id,
    role: data.role as Staff["role"],
    fullName: data.full_name,
  };
});

/** Ids of the clients the caller is a contact of. */
export const getContactClientIds = cache(async (): Promise<string[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("client_contacts").select("client_id").eq("user_id", user.id);
  if (error) throw error;
  return data.map((row) => row.client_id);
});

/** Where a signed-in user goes when no `next` path is given. */
export async function homePath(): Promise<string> {
  if (await getStaff()) return "/app";
  if ((await getContactClientIds()).length > 0) return "/portal";
  return "/onboarding";
}

/**
 * The caller's membership. Redirects everyone else to where they belong.
 * This decides navigation only; RLS is the security boundary.
 */
export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (staff) return staff;
  redirect((await getUser()) ? await homePath() : "/login");
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/app");
  return staff;
}
