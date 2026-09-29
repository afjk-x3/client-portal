const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What the bulk archive toast says: everything, or what a colleague archived first. */
export function archiveResultMessage(archived: number, selected: number): string {
  if (archived === selected) return `Archived ${plural(archived, "request")}.`;
  return `Archived ${archived} of ${plural(selected, "request")}. The rest had already changed.`;
}
