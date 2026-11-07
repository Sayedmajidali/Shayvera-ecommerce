import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import {
  refundReturn,
  refundReturnSchema,
  returnRefundQuote,
} from "@/server/modules/orders/requests";

/** What the received items are worth, and any refund already made for this return. */
export const GET = adminRoute<RouteCtx<{ id: string }>>(
  "RETURNS_MANAGE",
  async (_req, { params }) => ok(await returnRefundQuote((await params).id)),
  { csrf: false },
);

/** Refunds a received return: `{ amountPaise, includeShipping?, note? }`. */
export const POST = adminRoute<RouteCtx<{ id: string }>>(
  ["RETURNS_MANAGE", "PAYMENTS_REFUND"],
  async (req, { params }, { actor }) => {
    const refund = await refundReturn(
      (await params).id,
      await parseJson(req, refundReturnSchema),
      actor,
    );
    return ok({ refundId: refund.id, status: refund.status }, 201);
  },
);
