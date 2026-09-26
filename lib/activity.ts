import { formatDate } from "@/lib/dates";

type Detail = Record<string, unknown>;

/** Events the Activity section shows, newest first. Older ones are left out, and the section says so. */
export const ACTIVITY_LIMIT = 200;

const quoted = (value: unknown) => `“${String(value)}”`;

/** Who did it: a staff member or contact by name, "PaperLine" for the daily job, or "Former user". */
export function actorName(actorId: string | null, names: ReadonlyMap<string, string>): string {
  if (actorId === null) return "PaperLine";
  return names.get(actorId) ?? "Former user";
}

/** The item's current title, else the title the event kept, else "an item" for one since removed. */
export function itemLabel(itemId: string | null, detail: Detail, titles: ReadonlyMap<string, string>): string {
  return (itemId && titles.get(itemId)) || (typeof detail.title === "string" ? detail.title : "an item");
}

/** What happened, after the actor's name: "accepted Photo ID". */
export function describeEvent(kind: string, detail: Detail, item: string): string {
  switch (kind) {
    case "sent":
      return "sent the request";
    case "details_changed": {
      const changes: string[] = [];
      const title = detail.title as [string, string] | undefined;
      const due = detail.due_date as [string, string] | undefined;
      if (title) changes.push(`changed the title from ${quoted(title[0])} to ${quoted(title[1])}`);
      if (due) changes.push(`changed the due date from ${formatDate(due[0])} to ${formatDate(due[1])}`);
      return changes.join(" and ") || "changed the request";
    }
    case "item_added":
      return `added the item ${quoted(item)}`;
    case "item_removed":
      return `removed the item ${quoted(item)}`;
    case "file_added":
      return `added ${quoted(detail.filename)} to ${item}`;
    case "file_removed":
      return `removed ${quoted(detail.filename)} from ${item}`;
    case "submitted":
      return `submitted ${item}`;
    case "accepted":
      return `accepted ${item}`;
    case "returned":
      return `returned ${item}: ${quoted(detail.note)}`;
    case "reminder_sent":
      return detail.manual ? "sent a reminder" : "sent the daily reminder";
    case "archived":
      return "archived the request";
    case "unarchived":
      return "unarchived the request";
    case "completed":
      return "completed the request";
    case "reopened":
      return "reopened the request";
    default:
      return kind;
  }
}
