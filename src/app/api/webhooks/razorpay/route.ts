import { toErrorResponse } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { handleRazorpayWebhook } from "@/server/modules/payments/payments";

const MAX_BODY = 256 * 1024;

/**
 * Razorpay webhook endpoint. Authenticated by HMAC over the raw body (no cookies, no CSRF check).
 * Always reads the body as text before parsing so the signature covers the exact bytes received.
 */
export async function POST(req: Request) {
  try {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) throw new AppError("PAYLOAD_TOO_LARGE", "Payload too large");
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw new AppError("PAYLOAD_TOO_LARGE", "Payload too large");
    const result = await handleRazorpayWebhook(
      raw,
      req.headers.get("x-razorpay-signature"),
      req.headers.get("x-razorpay-event-id"),
    );
    return Response.json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    // 4xx for bad signatures/payloads; 5xx makes Razorpay retry transient failures.
    return toErrorResponse(error);
  }
}
