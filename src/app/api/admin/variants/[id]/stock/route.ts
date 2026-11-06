import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { stockAdjustmentSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { audit } from "@/server/modules/audit/audit";
import { moveStock } from "@/server/modules/inventory/inventory";

type Ctx = RouteCtx<{ id: string }>;

export const GET = adminRoute<Ctx>(
  async (_req, { params }) => {
    const { id } = await params;
    const history = await db.inventoryTransaction.findMany({
      where: { variantId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok(history);
  },
  { csrf: false },
);

/** Manual stock adjustment; negative adjustments cannot take stock below zero. */
export const POST = adminRoute<Ctx>(async (req, { params }, { actor }) => {
  const { id } = await params;
  const input = await parseJson(req, stockAdjustmentSchema);
  if (!(await db.productVariant.findUnique({ where: { id }, select: { id: true } }))) {
    throw new AppError("NOT_FOUND", "Variant not found");
  }
  const balance = await db.$transaction(async (tx) => {
    const after = await moveStock(tx, {
      variantId: id,
      delta: input.delta,
      reason: input.reason,
      note: input.note,
      actorId: actor.id,
    });
    await audit(
      {
        actorId: actor.id,
        action: "inventory.adjust",
        entityType: "ProductVariant",
        entityId: id,
        metadata: { delta: input.delta, reason: input.reason, balance: after },
        ipAddress: actor.ip,
      },
      tx,
    );
    return after;
  });
  return ok({ quantityOnHand: balance });
});
