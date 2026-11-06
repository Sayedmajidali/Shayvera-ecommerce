import { z } from "zod";
import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { optionalTrimmed } from "@/lib/validation/common";
import { audit } from "@/server/modules/audit/audit";

type AdminActor = { id: string; ip?: string | null };

// ───────────────────────────── Coupons ─────────────────────────────

export const couponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, "Code must be at least 3 characters")
      .max(32)
      .regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, - or _"),
    description: optionalTrimmed(200),
    type: z.enum(["PERCENTAGE", "FIXED"]),
    value: z.coerce.number().int().positive("Value must be positive"),
    minOrderPaise: z.coerce.number().int().min(0).default(0),
    maxDiscountPaise: z.coerce.number().int().positive().nullable().optional(),
    usageLimit: z.coerce.number().int().positive().nullable().optional(),
    usageLimitPerUser: z.coerce.number().int().positive().nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.type !== "PERCENTAGE" || c.value <= 10_000, {
    message: "Percentage cannot exceed 100%",
    path: ["value"],
  })
  .refine((c) => !c.startsAt || !c.expiresAt || c.expiresAt > c.startsAt, {
    message: "Expiry must be after the start date",
    path: ["expiresAt"],
  });
export type CouponInput = z.infer<typeof couponInputSchema>;

export async function listCoupons() {
  return db.coupon.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { usages: true } } },
  });
}

export async function saveCoupon(id: string | null, input: CouponInput, actor: AdminActor) {
  const clash = await db.coupon.findUnique({ where: { code: input.code } });
  if (clash && clash.id !== id)
    throw new AppError("CONFLICT", "A coupon with this code already exists", {
      code: "Code already in use",
    });
  return db.$transaction(async (tx) => {
    const data = {
      ...input,
      maxDiscountPaise: input.type === "PERCENTAGE" ? (input.maxDiscountPaise ?? null) : null,
      usageLimit: input.usageLimit ?? null,
      usageLimitPerUser: input.usageLimitPerUser ?? null,
      startsAt: input.startsAt ?? null,
      expiresAt: input.expiresAt ?? null,
    };
    if (id) {
      const existing = await tx.coupon.findUnique({ where: { id } });
      if (!existing) throw new AppError("NOT_FOUND", "Coupon not found");
      if (data.usageLimit !== null && data.usageLimit < existing.usedCount) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Usage limit cannot be below current uses (${existing.usedCount})`,
          { usageLimit: "Below current usage" },
        );
      }
    }
    const coupon = id
      ? await tx.coupon.update({ where: { id }, data })
      : await tx.coupon.create({ data });
    await audit(
      {
        actorId: actor.id,
        action: id ? "coupon.update" : "coupon.create",
        entityType: "Coupon",
        entityId: coupon.id,
        metadata: { code: coupon.code },
        ipAddress: actor.ip,
      },
      tx,
    );
    return coupon;
  });
}

export async function deleteCoupon(id: string, actor: AdminActor) {
  const coupon = await db.coupon.findUnique({
    where: { id },
    include: { _count: { select: { usages: true } } },
  });
  if (!coupon) throw new AppError("NOT_FOUND", "Coupon not found");
  if (coupon._count.usages > 0) {
    await db.coupon.update({ where: { id }, data: { isActive: false } });
    await audit({
      actorId: actor.id,
      action: "coupon.deactivate",
      entityType: "Coupon",
      entityId: id,
      ipAddress: actor.ip,
    });
    return { action: "deactivated" as const };
  }
  await db.coupon.delete({ where: { id } });
  await audit({
    actorId: actor.id,
    action: "coupon.delete",
    entityType: "Coupon",
    entityId: id,
    metadata: { code: coupon.code },
    ipAddress: actor.ip,
  });
  return { action: "deleted" as const };
}
