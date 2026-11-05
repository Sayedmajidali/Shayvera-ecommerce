import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { MockGateway, paymentGateway } from "@/server/payments/gateway";

const schema = z.object({
  razorpayOrderId: z.string().min(1).max(64),
  outcome: z.enum(["captured", "failed"]),
});

/**
 * DEVELOPMENT/TEST ONLY: simulates the Razorpay Checkout modal when PAYMENT_GATEWAY=mock.
 * Returns the same signed payload Checkout.js would hand to the browser. Disabled for the real gateway
 * and refused in production by env validation.
 */
export const POST = route(async (req) => {
  const gateway = paymentGateway();
  if (!(gateway instanceof MockGateway)) throw new AppError("NOT_FOUND", "Not found");
  const { razorpayOrderId, outcome } = await parseJson(req, schema);
  return ok(gateway.simulateCheckout(razorpayOrderId, outcome));
});
