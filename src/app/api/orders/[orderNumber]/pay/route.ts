import { z } from "zod";
import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { orderRequester } from "@/server/modules/orders/order-requester";
import { resolveOrderForRequester } from "@/server/modules/orders/order-actions";
import { startOnlinePayment } from "@/server/modules/payments/payments";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import { clientIp } from "@/server/modules/audit/audit";

/** Starts or resumes payment for a pending online order (retry after failure / interrupted checkout). */
export const POST = route<RouteCtx<{ orderNumber: string }>>(async (req, { params }) => {
  const { orderNumber } = await params;
  // Each attempt may call Razorpay: cap per order and per client.
  await enforceRateLimit(`pay:order:${orderNumber}`, 20, 3600);
  await enforceRateLimit(`pay:ip:${clientIp(req) ?? "unknown"}`, 60, 3600);
  const body = await parseJson(req, z.object({ token: z.string().max(64).optional().nullable() }));
  const order = await resolveOrderForRequester(orderNumber, await orderRequester(req, body.token));
  return ok(await startOnlinePayment(order.id));
});
