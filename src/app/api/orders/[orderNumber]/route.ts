import { ok, route, type RouteCtx } from "@/lib/api";
import { orderRequester } from "@/server/modules/orders/order-requester";
import { resolveOrderForRequester } from "@/server/modules/orders/order-actions";

export const GET = route<RouteCtx<{ orderNumber: string }>>(
  async (req, { params }) => {
    const order = await resolveOrderForRequester(
      (await params).orderNumber,
      await orderRequester(req),
    );
    const { idempotencyKey: _k, ...safe } = order;
    void _k;
    return ok(safe, { headers: { "Cache-Control": "no-store" } });
  },
  { csrf: false },
);
