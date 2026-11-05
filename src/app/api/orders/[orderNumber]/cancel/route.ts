import { z } from "zod";
import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { orderRequester } from "@/server/cart/order-requester";
import { cancelOrderAsCustomer } from "@/server/services/order-actions";

const schema = z.object({
  reason: z.string().trim().max(200).optional().nullable(),
  token: z.string().max(64).optional().nullable(),
});

export const POST = route<RouteCtx<{ orderNumber: string }>>(async (req, { params }) => {
  const body = await parseJson(req, schema);
  const order = await cancelOrderAsCustomer(
    (await params).orderNumber,
    await orderRequester(req, body.token),
    body.reason,
  );
  return ok({ status: order.status, paymentStatus: order.paymentStatus });
});
