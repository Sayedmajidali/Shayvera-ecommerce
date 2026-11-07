import { Prisma } from "@prisma/client";
import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { stockAdjustmentSchema } from "@/lib/validation/catalog";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { audit } from "@/server/modules/audit/audit";
import { moveStock } from "@/server/modules/inventory/inventory";

type Ctx = RouteCtx<{ id: string }>;

export const GET = adminRoute<Ctx>(
  "INVENTORY_MANAGE",
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
export const POST = adminRoute<Ctx>("INVENTORY_MANAGE", async (req, { params }, { actor }) => {
  const { id } = await params;
  const input = await parseJson(req, stockAdjustmentSchema);
  if (!(await db.productVariant.findUnique({ where: { id }, select: { id: true } }))) {
    throw new AppError("NOT_FOUND", "Variant not found");
  }
  const replay = async () => {
    const prior = await db.inventoryTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (!prior) return null;
    if (prior.variantId !== id || prior.delta !== input.delta)
      throw new AppError("CONFLICT", "This adjustment key was already used for another change");
    const inv = await db.inventory.findUniqueOrThrow({ where: { variantId: id } });
    return ok({
      quantityOnHand: inv.quantityOnHand,
      quantityReserved: inv.quantityReserved,
      available: inv.quantityOnHand - inv.quantityReserved,
      replayed: true,
    });
  };
  const earlier = await replay();
  if (earlier) return earlier;
  const balance = await db
    .$transaction(async (tx) => {
      const after = await moveStock(tx, {
        variantId: id,
        delta: input.delta,
        reason: input.reason,
        note: input.note,
        actorId: actor.id,
        idempotencyKey: input.idempotencyKey,
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
    })
    .catch(async (e: unknown) => {
      // A concurrent duplicate of this request committed first: answer as it did.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
      throw e;
    });
  if (balance === null) return (await replay())!;
  const inv = await db.inventory.findUniqueOrThrow({ where: { variantId: id } });
  return ok({
    quantityOnHand: balance,
    quantityReserved: inv.quantityReserved,
    available: inv.quantityOnHand - inv.quantityReserved,
  });
});
