import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import { clientIp } from "@/server/modules/audit/audit";
import { orderRequester } from "@/server/modules/orders/order-requester";
import { cancellationRequestSchema, customerCancel } from "@/server/modules/orders/requests";
import { db } from "@/server/platform/db";

/**
 * Customer "cancel": unpaid orders are cancelled immediately (`outcome: "cancelled"`); accepted
 * orders not yet handed to the courier become a cancellation request for staff (`outcome: "requested"`).
 */
export const POST = route<RouteCtx<{ orderNumber: string }>>(async (req, { params }) => {
  const { orderNumber } = await params;
  await enforceRateLimit(`order-cancel:${clientIp(req) ?? "unknown"}`, 10, 600);
  const { reason, token } = await parseJson(req, cancellationRequestSchema);
  const who = await orderRequester(req, token);
  const result = await customerCancel(orderNumber, who, reason);
  const order = await db.order.findUniqueOrThrow({
    where: { orderNumber },
    select: { orderNumber: true, status: true },
  });
  return ok({ ...result, ...order });
});
