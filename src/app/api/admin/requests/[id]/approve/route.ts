import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { db } from "@/server/platform/db";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { hasPermission } from "@/server/modules/auth/permissions";
import { approveRequest, resolveRequestSchema } from "@/server/modules/orders/requests";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "RETURNS_MANAGE",
  async (req, { params }, { admin, actor }) => {
    const { id } = await params;
    const { note } = await parseJson(req, resolveRequestSchema);
    const r = await db.orderRequest.findUnique({
      where: { id },
      include: { order: { select: { paymentMethod: true, paymentStatus: true } } },
    });
    // Approving a cancellation of a paid online order refunds it, so it needs refund rights too.
    if (
      r?.type === "CANCELLATION" &&
      r.order.paymentMethod === "RAZORPAY" &&
      r.order.paymentStatus === "PAID" &&
      !hasPermission(admin.permissions, "PAYMENTS_REFUND")
    )
      throw new AppError(
        "FORBIDDEN",
        "Approving this cancellation issues a refund; you need refund permission",
      );
    return ok(await approveRequest(id, note, actor));
  },
);
