import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Capability token that lets a guest view their own order confirmation without an account.
 * HMAC-SHA256 of the order id with the server secret; not guessable and not stored.
 */
export function orderAccessToken(orderId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`order-access:${orderId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyOrderAccessToken(orderId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(orderAccessToken(orderId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Read-only tracking token, issued after an order-number + email/phone lookup. It only opens the
 * tracking view (status, items, shipment) — never addresses, payment or cancellation, which need
 * the full access token or the signed-in owner.
 */
export function orderTrackToken(orderId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`order-track:${orderId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyOrderTrackToken(orderId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(orderTrackToken(orderId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
