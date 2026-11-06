import { z } from "zod";
import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { orderRequester } from "@/server/modules/orders/order-requester";
import { resolveOrderForRequester } from "@/server/modules/orders/order-actions";
import { startOnlinePayment } from "@/server/modules/payments/payments";

/** Starts or resumes payment for a pending online order (retry after failure / interrupted checkout). */
export const POST = route<RouteCtx<{ orderNumber: string }>>(async (req, { params }) => {
  const body = await parseJson(req, z.object({ token: z.string().max(64).optional().nullable() }));
  const order = await resolveOrderForRequester(
    (await params).orderNumber,
    await orderRequester(req, body.token),
  );
  return ok(await startOnlinePayment(order.id));
});
