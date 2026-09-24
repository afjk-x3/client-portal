const BASE = "http://next.invalid";

/**
 * Returns `next` as a safe relative path for a post-sign-in redirect,
 * otherwise null. Rejects protocol-relative URLs ("//host", "/\host") and
 * control characters, which browsers strip before resolving a URL, then
 * resolves "." and ".." segments so "/..//host" cannot become "//host".
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  const url = new URL(next, BASE);
  if (url.origin !== BASE || url.pathname.startsWith("//")) return null;
  return url.pathname + url.search + url.hash;
}
