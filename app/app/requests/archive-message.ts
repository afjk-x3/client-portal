const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What the bulk archive toast says: everything, or what a colleague archived first. */
export function archiveResultMessage(archived: number, selected: number): string {
  if (archived === selected) return `Archived ${plural(archived, "request")}.`;
  return `Archived ${archived} of ${plural(selected, "request")}. The rest had already changed.`;
}

/** What the bulk unarchive toast says: everything, or what a colleague reopened first. */
export function unarchiveResultMessage(unarchived: number, selected: number): string {
  if (unarchived === selected) return `Unarchived ${plural(unarchived, "request")}.`;
  return `Unarchived ${unarchived} of ${plural(selected, "request")}. The rest were already open.`;
}
