/** How many notes a list shows. The pages ask for one more, to tell whether older ones exist. */
export const NOTES_LIMIT = 200;

/** A note's author: their name while they are on the firm, "Former staff member" once gone. */
export function noteAuthor(authorId: string, names: ReadonlyMap<string, string>): string {
  return names.get(authorId) ?? "Former staff member";
}
