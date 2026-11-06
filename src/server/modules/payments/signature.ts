import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export function hmacSha256Hex(data: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Razorpay Checkout callback: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(p: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret: string;
}): boolean {
  if (!p.secret) return false;
  return safeEqualHex(hmacSha256Hex(`${p.orderId}|${p.paymentId}`, p.secret), p.signature);
}

/** Razorpay webhook: HMAC_SHA256(raw request body, webhook secret) in X-Razorpay-Signature. */
export function verifyWebhookSignature(p: {
  rawBody: string | Buffer;
  signature: string | null;
  secret: string;
}): boolean {
  if (!p.secret || !p.signature) return false;
  return safeEqualHex(hmacSha256Hex(p.rawBody, p.secret), p.signature);
}
