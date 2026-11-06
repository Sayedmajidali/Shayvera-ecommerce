import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { enforceRateLimit } from "@/server/platform/rate-limit";
import { clientIp } from "@/server/modules/audit/audit";
import { orderRequester } from "@/server/modules/orders/order-requester";
import { requestReturn, returnRequestSchema } from "@/server/modules/orders/requests";

/** Customer return request for delivered items within the return window. */
export const POST = route<RouteCtx<{ orderNumber: string }>>(async (req, { params }) => {
  const { orderNumber } = await params;
  await enforceRateLimit(`order-return:${clientIp(req) ?? "unknown"}`, 10, 600);
  const { token, ...input } = await parseJson(req, returnRequestSchema);
  const who = await orderRequester(req, token);
  return ok(await requestReturn(orderNumber, who, input), 201);
});
