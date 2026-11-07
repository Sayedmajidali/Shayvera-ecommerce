import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { courierQuotes } from "@/server/modules/shipping/shipments";

/** Courier options and rates for booking (staff only; rates are never sent to customers). */
export const GET = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (_req, { params }) => ok(await courierQuotes((await params).id)),
  { csrf: false },
);
