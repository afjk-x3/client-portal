import { z } from "zod";
import { MAX_ITEMS_PER_REQUEST } from "@/lib/constants";

// Limits match the check constraints in supabase/migrations.
const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

export const firmNameSchema = text("Firm name", 120);
export const personNameSchema = text("Name", 200);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
export const reviewNoteSchema = text("Note", 1000);
export const textAnswerSchema = text("Answer", 5000);
export const dueDateSchema = z.iso.date("Pick a due date.");

export const onboardingSchema = z.object({
  firmName: firmNameSchema,
  fullName: personNameSchema,
});

export const clientSchema = z.object({
  name: text("Client name", 200),
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
  role: z.enum(["admin", "staff"]),
});

export const itemSchema = z.object({
  title: text("Item title", 200),
  description: z
    .string()
    .trim()
    .max(2000, "Descriptions must be 2,000 characters or fewer.")
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
  title: text("Title", 200),
  dueDate: dueDateSchema,
  items: itemsSchema,
});

export const requestDetailsSchema = z.object({
  title: text("Title", 200),
  dueDate: dueDateSchema,
});

export const templateSchema = z.object({
  templateId: z.uuid(),
  name: text("Template name", 200),
  items: itemsSchema,
});

export type ItemInput = z.input<typeof itemSchema>;
