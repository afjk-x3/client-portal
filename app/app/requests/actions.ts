"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { isOverdue, todayIn } from "@/lib/dates";
import { emailConfigError, sendEmails } from "@/lib/email/send";
import { needsChangesEmail, reminderEmail, requestSentEmail } from "@/lib/email/templates";
import { fail, invalid, notFound, staleState, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { bulkSendSchema, draftSchema, isId, itemSchema, requestDetailsSchema, reviewNoteSchema } from "@/lib/validation";

/**
 * Creates a draft, or replaces a draft's fields and items, in one transaction
 * (`save_draft`). A sent request fails with `invalid_state` and is not touched.
 */
export async function saveDraft(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string }>> {
  await requireStaff();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { requestId, clientId, title, dueDate, items } = parsed.data;

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_draft", {
    client_id: clientId,
    title,
    due_date: dueDate,
    items,
    request_id: requestId,
  });
  if (error) return fail(error);

  revalidatePath(`/app/requests/${id}`);
  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true, data: { id } };
}

/** Accept and return work only while the request is open or completed. */
function isReviewable(status: string | undefined) {
  return status === "open" || status === "completed";
}

/** Section 10.4. The guarded update makes a double click harmless. */
export async function sendRequest(requestId: string): Promise<ActionResult<{ contacts: number }>> {
  const staff = await requireStaff();
  if (!isId(requestId)) return fail(notFound);
  const supabase = await createClient();
  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select("id, title, due_date, client_id, request_items(required)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (requestError) return fail(requestError);
  if (!request) return fail(notFound);
  if (!request.request_items.some((item) => item.required)) {
    return { ok: false, error: "Add at least one required item before sending." };
  }

  // Build the emails before changing anything, so a configuration error leaves the draft as is.
  const [contacts, firm] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", request.client_id),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  if (contacts.error) return fail(contacts.error);
  if (firm.error) return fail(firm.error);
  const firmName = firm.data.name;
  const content = requestSentEmail({
    firmName,
    title: request.title,
    dueDate: request.due_date,
    itemCount: request.request_items.length,
    requestId,
  });
  const messages = contacts.data.map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

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

/**
 * Emails the open items to the client's contacts now. It shares the daily
 * reminder's claim, so a request gets at most one reminder a day.
 */
export async function sendReminder(requestId: string): Promise<ActionResult<{ contacts: number }>> {
  const staff = await requireStaff();
  if (!isId(requestId)) return fail(notFound);
  const supabase = await createClient();
  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select("id, title, due_date, client_id, request_items(title, status)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .order("position", { referencedTable: "request_items" })
    .maybeSingle();
  if (requestError) return fail(requestError);
  if (!request) return fail(notFound);

  // Checked and built before the claim, so a configuration error does not use up today's reminder.
  if (emailConfigError()) return { ok: false, error: "Email is not set up, so no reminder was sent." };
  const [contacts, firm] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", request.client_id),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  if (contacts.error) return fail(contacts.error);
  if (firm.error) return fail(firm.error);
  if (contacts.data.length === 0) return { ok: false, error: "This client has no contacts to remind." };
  const firmName = firm.data.name;
  const content = reminderEmail({
    firmName,
    title: request.title,
    dueDate: request.due_date,
    overdue: isOverdue(request.due_date, todayIn(staff.timeZone)),
    openItems: request.request_items
      .filter((item) => item.status === "requested" || item.status === "needs_changes")
      .map((item) => item.title),
    requestId,
  });
  const messages = contacts.data.map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

  const { data: claimed, error } = await supabase.rpc("claim_reminder", { request_id: requestId });
  if (error) return fail(error);
  if (!claimed) return { ok: false, error: "A reminder already went out today." };

  after(() => sendEmails(messages));
  return { ok: true, data: { contacts: messages.length } };
}

/**
 * Sends a template to several clients: one request each, created and sent in
 * one transaction (`send_requests`), then one email per contact.
 */
export async function sendToClients(input: z.input<typeof bulkSendSchema>): Promise<ActionResult<{ requests: number }>> {
  const staff = await requireStaff();
  const parsed = bulkSendSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { templateId, title, dueDate, clientIds } = parsed.data;

  const supabase = await createClient();
  const [template, clients, firm] = await Promise.all([
    supabase
      .from("templates")
      .select("template_items(required)")
      .eq("id", templateId)
      .eq("firm_id", staff.firmId)
      .maybeSingle(),
    // Contacts come embedded, so no response row limit can drop any.
    supabase.from("clients").select("id, client_contacts(email)").eq("firm_id", staff.firmId).in("id", clientIds),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  if (template.error) return fail(template.error);
  if (clients.error) return fail(clients.error);
  if (firm.error) return fail(firm.error);
  if (!template.data) return fail(notFound);
  const items = template.data.template_items;
  if (!items.some((item) => item.required)) {
    return { ok: false, error: "Add at least one required item to the template before sending it." };
  }

  // Build every email before anything changes, so a configuration error sends nothing.
  const firmName = firm.data.name;
  const requestIds = clientIds.map(() => crypto.randomUUID());
  const messages = clientIds.flatMap((clientId, index) => {
    const content = requestSentEmail({ firmName, title, dueDate, itemCount: items.length, requestId: requestIds[index] });
    const contacts = clients.data.find((client) => client.id === clientId)?.client_contacts ?? [];
    return contacts.map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));
  });

  const { error } = await supabase.rpc("send_requests", {
    template_id: templateId,
    title,
    due_date: dueDate,
    client_ids: clientIds,
    request_ids: requestIds,
  });
  if (error) return fail(error);

  after(() => sendEmails(messages));

  revalidatePath("/app", "layout");
  return { ok: true, data: { requests: clientIds.length } };
}

export async function deleteDraft(requestId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(requestId)) return fail(notFound);
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
  if (!isId(requestId)) return fail(notFound);
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
  if (!isId(requestId)) return fail(notFound);
  const parsed = itemSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    kind: formData.get("kind"),
    required: formData.get("required") === "on",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select("status, request_items(position)")
    .eq("id", requestId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (requestError) return fail(requestError);
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

/**
 * Allowed only while the item is `requested`, has no files, and the request is open or
 * completed. `remove_item` checks and deletes under one row lock, so a file a contact is
 * registering at the same moment is never deleted with the item.
 */
export async function removeItem(itemId: string): Promise<ActionResult> {
  await requireStaff();
  if (!isId(itemId)) return fail(notFound);
  const supabase = await createClient();
  const { data: requestId, error } = await supabase.rpc("remove_item", { item_id: itemId });
  if (error) return fail(error);

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}

/** Staff may accept an item in any state except accepted (paper copies count). */
export async function acceptItem(itemId: string): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!isId(itemId)) return fail(notFound);
  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("request_items")
    .select("requests(status)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (itemError) return fail(itemError);
  if (!item) return fail(notFound);
  if (!isReviewable(item.requests?.status)) return fail(staleState);

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
  if (!isId(itemId)) return fail(notFound);
  const note = reviewNoteSchema.safeParse(formData.get("note"));
  if (!note.success) return invalid(note.error);

  const supabase = await createClient();
  const { data: item, error: itemError } = await supabase
    .from("request_items")
    .select("title, request_id, requests(client_id, status)")
    .eq("id", itemId)
    .eq("firm_id", staff.firmId)
    .maybeSingle();
  if (itemError) return fail(itemError);
  if (!item?.requests) return fail(notFound);
  // A closed request's portal is read-only, so its contacts could not act on the note.
  if (!isReviewable(item.requests.status)) return fail(staleState);

  // Build the emails before changing anything, so a configuration error leaves the item as is.
  const [contacts, firm] = await Promise.all([
    supabase.from("client_contacts").select("email").eq("client_id", item.requests.client_id),
    supabase.from("firms").select("name").eq("id", staff.firmId).single(),
  ]);
  if (contacts.error) return fail(contacts.error);
  if (firm.error) return fail(firm.error);
  const firmName = firm.data.name;
  const content = needsChangesEmail({ firmName, itemTitle: item.title, note: note.data, requestId: item.request_id });
  const messages = contacts.data.map((c) => ({ ...content, to: c.email, fromName: firmName, replyTo: staff.email }));

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
  if (!isId(requestId) || typeof archived !== "boolean") return fail(notFound);
  const supabase = await createClient();
  // Unarchiving goes straight to the status the items call for (open or completed), in one step.
  const { data, error } = archived
    ? await supabase
        .from("requests")
        .update({ status: "archived" })
        .eq("id", requestId)
        .eq("firm_id", staff.firmId)
        .in("status", ["open", "completed"])
        .select("id")
        .maybeSingle()
    : await supabase.rpc("unarchive_request", { request_id: requestId });
  if (error) return fail(error);
  // The unarchive function returns null when the request was not archived or not the caller's.
  if (!data) return fail(staleState);

  revalidatePath(`/app/requests/${requestId}`);
  return { ok: true };
}
