import { z } from "zod";
import { LIMITS, MAX_CLIENTS_PER_SEND, MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { isTimeZone } from "@/lib/dates";

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer.`);

/** Trimmed optional text: a blank or missing value becomes null instead of an error. */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer.`)
    .optional()
    .transform((value) => value || null);

export const firmNameSchema = text("Firm name", LIMITS.firmName);
export const personNameSchema = text("Name", LIMITS.name);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
export const reviewNoteSchema = text("Note", LIMITS.reviewNote);
export const textAnswerSchema = text("Answer", LIMITS.textAnswer);
export const unavailableReasonSchema = text("Reason", LIMITS.unavailableReason);
export const filenameSchema = text("File name", LIMITS.filename);
export const messageSchema = optionalText("Message", LIMITS.message);
export const dueDateSchema = z.iso.date("Pick a due date.");
export const roleSchema = z.enum(["admin", "staff"]);
export const timeZoneSchema = z.string().refine(isTimeZone, "Pick a time zone.");
/** The retention select's value: "forever" or a number of years, as null or the year count. */
export const retentionSchema = z
  .enum(["forever", "1", "2", "3", "5", "7", "10"])
  .transform((value) => (value === "forever" ? null : Number(value)));

const idSchema = z.uuid();

/** True for a well-formed id. Actions and pages treat anything else as not found. */
export function isId(value: unknown): value is string {
  return idSchema.safeParse(value).success;
}

export const onboardingSchema = z.object({
  firmName: firmNameSchema,
  fullName: personNameSchema,
  // Detected in the browser. One this server does not know falls back to UTC; admins can change it in Settings.
  timeZone: timeZoneSchema.catch("UTC"),
});

export const clientSchema = z.object({
  name: text("Client name", LIMITS.name),
  kind: z.enum(["individual", "business"]),
  // "none" because a select option cannot have an empty value.
  ownerId: z.union([z.literal("none"), z.uuid()]).transform((v) => (v === "none" ? null : v)),
});

export const contactSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
});

export const staffSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
  role: roleSchema,
});

export const itemSchema = z.object({
  title: text("Item title", LIMITS.name),
  description: z
    .string()
    .trim()
    .max(LIMITS.description, "Descriptions must be 2,000 characters or fewer.")
    .transform((v) => v || null),
  kind: z.enum(["file", "text"]),
  required: z.boolean(),
});

export const itemsSchema = z
  .array(itemSchema)
  .max(MAX_ITEMS_PER_REQUEST, `A request can have at most ${MAX_ITEMS_PER_REQUEST} items.`);

export const draftSchema = z.object({
  requestId: z.uuid().optional(),
  clientId: z.uuid(),
  title: text("Title", LIMITS.name),
  dueDate: dueDateSchema,
  items: itemsSchema,
  message: messageSchema,
});

export const requestDetailsSchema = z.object({
  title: text("Title", LIMITS.name),
  dueDate: dueDateSchema,
  message: messageSchema,
});

export const bulkSendSchema = z.object({
  templateId: z.uuid(),
  title: text("Title", LIMITS.name),
  dueDate: dueDateSchema,
  message: messageSchema,
  clientIds: z
    .array(z.uuid())
    .min(1, "Pick at least one client.")
    .max(MAX_CLIENTS_PER_SEND, `Pick at most ${MAX_CLIENTS_PER_SEND} clients at a time.`)
    .transform((ids) => [...new Set(ids)]),
});

export const templateSchema = z.object({
  templateId: z.uuid(),
  name: text("Template name", LIMITS.name),
  items: itemsSchema,
});

export type ItemInput = z.input<typeof itemSchema>;
