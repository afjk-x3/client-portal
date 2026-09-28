/** The typed confirmation equals the client's name once trimmed; case still matters. */
export function confirmsName(typed: string, name: string): boolean {
  return typed.trim() === name;
}
