/** Only allows same-site relative paths, preventing open redirects (e.g. "//evil.com", "https://…"). */
export function safeRedirectPath(input: string | null | undefined, fallback = "/account"): string {
  if (!input || typeof input !== "string") return fallback;
  if (!input.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(input)) return fallback;
  return input;
}
