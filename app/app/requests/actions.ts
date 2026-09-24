"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { sendEmails } from "@/lib/email/send";
import { needsChangesEmail, requestSentEmail } from "@/lib/email/templates";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { draftSchema, itemSchema, requestDetailsSchema, reviewNoteSchema } from "@/lib/validation";

/** Creates a draft, or replaces a draft's fields and items. */
export async function saveDraft(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string }>> {
  const staff = await requireStaff();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { requestId, clientId, title, dueDate, items } = parsed.data;
  const supabase = await createClient();

  let id = requestId;
  if (id) {
    const { data, error } = await supabase
      .from("requests")
      .update({ title, due_date: dueDate })
      .eq("id", id)
      .eq("firm_id", staff.firmId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) return fail(error);
    if (!data) return fail(staleState);
    const { error: deleteError } = await supabase.from("request_items").delete().eq("request_id", id);
    if (deleteError) return fail(deleteError);
  } else {
    const { data, error } = await supabase
      .from("requests")
      .insert({ firm_id: staff.firmId, client_id: clientId, title, due_date: dueDate, created_by: staff.userId })
      .select("id")
      .single();
    if (error) return fail(error);
    id = data.id;
  }

  if (items.length > 0) {
    const requestIdForItems = id;
    const { error } = await supabase.from("request_items").insert(
      items.map((item, index) => ({
        ...item,
        request_id: requestIdForItems,
        firm_id: staff.firmId,
        position: index + 1,
      })),
    );
    if (error) return fail(error);
  }

  revalidatePath(`/app/requests/${id}`);
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true, data: { id } };
}

/** Section 10.4. The guarded update makes a double click harmless. */
export async function sendRequest(requestId: string): Promise<ActionResult<{ contacts: number }>> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("id, title, due_date, client_id, request_items(required)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!request) return fail(notFound);
  if (!request.request_items.some((item) => item.required)) {
    return { ok: false, error: "Add at least one required item before sending." };
  }

  // Build the emails before changing anything, so a configuration error leaves the draft as is.
  const [{ data: contacts }, { data: firm }] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", request.client_id),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  const firmName = firm?.name ?? "";
  const content = requestSentEmail({
    firmName,
    title: request.title,
    dueDate: request.due_date,
    itemCount: request.request_items.length,
    requestId,
  });
  const messages = (contacts ?? []).map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

  const { data: sent, error } = await supabase
    .from("requests")
    .update({ status: "open", sent_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!sent) return fail(staleState);

  after(() => sendEmails(messages));

  revalidatePath(`/app/requests/${requestId}`);
  revalidatePath(`/app/clients/${request.client_id}`);
  return { ok: true, data: { contacts: messages.length } };
}

export async function deleteDraft(requestId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .delete()
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .eq("status", "draft")
    .select("client_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  redirect(`/app/clients/${data.client_id}`);
}

/** Title and due date of a sent request (drafts use saveDraft). */
export async function updateRequestDetails(
  requestId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = requestDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .update({ title: parsed.data.title, due_date: parsed.data.dueDate })
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .in("status", ["open", "completed"])
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}

/** Adds an item to a sent request. A required item reopens a completed request (trigger). */
export async function addItem(requestId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = itemSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    kind: formData.get("kind"),
    required: formData.get("required") === "on",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("requests")
    .select("status, request_items(position)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!request) return fail(notFound);
  if (request.status !== "open" && request.status !== "completed") return fail(staleState);
  if (request.request_items.length >= MAX_ITEMS_PER_REQUEST) {
    return { ok: false, error: `A request can have at most ${MAX_ITEMS_PER_REQUEST} items.` };
  }

  const position = Math.max(0, ...request.request_items.map((item) => item.position)) + 1;
  const { error } = await supabase
    .from("request_items")
    .insert({ ...parsed.data, request_id: requestId, firm_id: staff.firmId, position });
  if (error) return fail(error);

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}

/** Allowed only while the item is `requested`, has no files, and the request is open or completed. */
export async function removeItem(itemId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("request_items")
    .select("request_id, status, requests(status), item_files(id)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!item) return fail(notFound);
  const requestOpen = item.requests?.status === "open" || item.requests?.status === "completed";
  if (!requestOpen || item.status !== "requested" || item.item_files.length > 0) return fail(staleState);

  const { data, error } = await supabase
    .from("request_items")
    .delete()
    .eq("id", itemId)
    .eq("status", "requested")
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath(`/app/requests/${item.request_id}`);
  return { ok: true };
}

/** Staff may accept an item in any state except accepted (paper copies count). */
export async function acceptItem(itemId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("request_items")
    .update({
      status: "accepted",
      review_note: null,
      reviewed_by: staff.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .neq("status", "accepted")
    .select("request_id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  revalidatePath(`/app/requests/${data.request_id}`);
  return { ok: true };
}

/** Returns a submitted or accepted item with a note, then emails the client's contacts. */
export async function returnItem(itemId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const note = reviewNoteSchema.safeParse(formData.get("note"));
  if (!note.success) return invalid(note.error);

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("request_items")
    .select("title, request_id, requests(client_id)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (!item) return fail(notFound);

  // Build the emails before changing anything, so a configuration error leaves the item as is.
  const [{ data: contacts }, { data: firm }] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", item.requests?.client_id ?? ""),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  const firmName = firm?.name ?? "";
  const content = needsChangesEmail({ firmName, itemTitle: item.title, note: note.data, requestId: item.request_id });
  const messages = (contacts ?? []).map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

  const { data: returned, error } = await supabase
    .from("request_items")
    .update({
      status: "needs_changes",
      review_note: note.data,
      reviewed_by: staff.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .in("status", ["submitted", "accepted"])
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!returned) return fail(staleState);

  after(() => sendEmails(messages));

  revalidatePath(`/app/requests/${item.request_id}`);
  return { ok: true };
}

/** Archive stops reminders. Unarchive reopens, then recomputes the status. */
export async function setRequestArchived(requestId: string, archived: boolean): Promise<ActionResult> {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .update({ status: archived ? "archived" : "open" })
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .in("status", archived ? ["open", "completed"] : ["archived"])
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return fail(staleState);

  if (!archived) {
    const { error: refreshError } = await supabase.rpc("refresh_request_status", { request_id: requestId });
    if (refreshError) return fail(refreshError);
  }

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}
