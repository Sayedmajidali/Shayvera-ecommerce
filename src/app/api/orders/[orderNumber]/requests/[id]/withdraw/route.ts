import { z } from "zod";
import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { orderRequester } from "@/server/modules/orders/order-requester";
import { withdrawRequest } from "@/server/modules/orders/requests";
import { enforceRateLimit } from "@/server/platform/rate-limit";

const body = z.object({ token: z.string().max(200).optional().nullable() });

/** The customer withdraws a pending cancellation/return request. */
export const POST = route<RouteCtx<{ orderNumber: string; id: string }>>(
  async (req, { params }) => {
    const { orderNumber, id } = await params;
    await enforceRateLimit(`withdraw:order:${orderNumber}`, 10, 3600);
    const { token } = await parseJson(req, body);
    await withdrawRequest(orderNumber, await orderRequester(req, token), id);
    return ok({ withdrawn: true });
  },
);
