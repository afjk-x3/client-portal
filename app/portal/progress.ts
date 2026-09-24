/** Percent of required items that are submitted or accepted. */
export function progressPercent(items: { required: boolean; status: string }[]): number {
  const required = items.filter((item) => item.required);
  if (required.length === 0) return 100;
  const done = required.filter((item) => item.status === "submitted" || item.status === "accepted").length;
  return Math.round((done / required.length) * 100);
}
