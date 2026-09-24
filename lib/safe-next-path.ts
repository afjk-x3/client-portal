/**
 * Returns `next` when it is a safe relative path for a post-sign-in redirect,
 * otherwise null. Rejects protocol-relative URLs ("//host", "/\host") and
 * control characters, which browsers strip before resolving a URL.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}
