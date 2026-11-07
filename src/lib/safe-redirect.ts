const BASE = "http://same-origin.invalid";

/**
 * Only allows same-site relative paths, preventing open redirects. The path is resolved with the
 * WHATWG URL parser (as a browser would — it strips tabs/newlines and treats "\" like "/"), and must
 * stay on the same origin; control characters are refused outright.
 * Examples refused: "//evil.com", "/\\evil.com", "/\t/evil.com", "https://evil.com", "javascript:…".
 */
export function safeRedirectPath(input: string | null | undefined, fallback = "/account"): string {
  if (!input || typeof input !== "string" || input.length > 2000) return fallback;
  if (!input.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(input)) return fallback;
  let url: URL;
  try {
    url = new URL(input, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
