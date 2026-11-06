import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { db } from "@/server/platform/db";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { hasPermission } from "@/server/modules/auth/permissions";
import { statusUpdateSchema, updateOrderStatusAdmin } from "@/server/modules/orders/admin-orders";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "ORDERS_MANAGE",
  async (req, { params }, { admin, actor }) => {
    const { id } = await params;
    const input = await parseJson(req, statusUpdateSchema);
    if (input.status === "CANCELLED" && !hasPermission(admin.permissions, "PAYMENTS_REFUND")) {
      // Cancelling a paid online order refunds it automatically, so it needs refund rights too.
      const order = await db.order.findUnique({
        where: { id },
        select: { paymentMethod: true, paymentStatus: true },
      });
      if (order?.paymentMethod === "RAZORPAY" && order.paymentStatus === "PAID")
        throw new AppError(
          "FORBIDDEN",
          "Cancelling a paid order issues a refund; you need refund permission",
        );
    }
    return ok(await updateOrderStatusAdmin(id, input, actor));
  },
);
