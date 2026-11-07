import { ok, type RouteCtx } from "@/lib/api";
import { audit } from "@/server/modules/audit/audit";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { retryWebhookEvent } from "@/server/modules/payments/payments";

/** Re-processes a stored, signature-verified webhook event that failed (it may change order state). */
export const POST = adminRoute<RouteCtx<{ id: string }>>(
  ["PAYMENTS_VIEW", "ORDERS_MANAGE"],
  async (_req, { params }, { actor }) => {
    const { id } = await params;
    await retryWebhookEvent(id);
    await audit({
      actorId: actor.id,
      action: "payment.event.retry",
      entityType: "PaymentEvent",
      entityId: id,
      ipAddress: actor.ip,
    });
    return ok({ queued: true });
  },
);
