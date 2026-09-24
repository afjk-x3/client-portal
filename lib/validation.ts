import { z } from "zod";
import { LIMITS, MAX_ITEMS_PER_REQUEST } from "@/lib/constants";

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer.`);

export const firmNameSchema = text("Firm name", LIMITS.firmName);
export const personNameSchema = text("Name", LIMITS.name);
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
export const reviewNoteSchema = text("Note", LIMITS.reviewNote);
export const textAnswerSchema = text("Answer", LIMITS.textAnswer);
export const filenameSchema = text("File name", LIMITS.filename);
export const dueDateSchema = z.iso.date("Pick a due date.");

export const onboardingSchema = z.object({
  firmName: firmNameSchema,
  fullName: personNameSchema,
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
  role: z.enum(["admin", "staff"]),
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
});

export const requestDetailsSchema = z.object({
  title: text("Title", LIMITS.name),
  dueDate: dueDateSchema,
});

export const templateSchema = z.object({
  templateId: z.uuid(),
  name: text("Template name", LIMITS.name),
  items: itemsSchema,
});

export type ItemInput = z.input<typeof itemSchema>;
