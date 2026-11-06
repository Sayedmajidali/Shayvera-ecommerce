import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { clientIp } from "@/server/modules/audit/audit";
import { verifyCheckoutCallback } from "@/server/modules/payments/payments";
import { enforceRateLimit } from "@/server/platform/rate-limit";

const schema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(64),
  razorpay_payment_id: z.string().trim().min(1).max(64),
  razorpay_signature: z.string().trim().min(1).max(128),
});

/** Checkout.js success handler. Signature + server-side fetch decide the outcome, never the client. */
export const POST = route(async (req) => {
  await enforceRateLimit(`verify:${clientIp(req) ?? "anon"}`, 30, 300);
  const cb = await parseJson(req, schema);
  return ok(await verifyCheckoutCallback(cb));
});
