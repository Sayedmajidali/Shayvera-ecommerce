import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { recordClientPaymentFailure } from "@/server/services/payments";

const schema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(64),
  razorpay_payment_id: z.string().trim().max(64).optional(),
  code: z.string().max(64).optional(),
  description: z.string().max(300).optional(),
});

/** Client-reported failure; confirmed against the gateway before anything changes. */
export const POST = route(async (req) => {
  const b = await parseJson(req, schema);
  await recordClientPaymentFailure(b.razorpay_order_id, {
    paymentId: b.razorpay_payment_id,
    code: b.code,
    description: b.description,
  });
  return ok({ recorded: true });
});
