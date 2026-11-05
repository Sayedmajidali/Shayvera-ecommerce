import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { INDIAN_STATES, isValidGstin, STATE_CODES } from "@/lib/india";
import { emailSchema, optionalTrimmed, trimmed } from "@/lib/validation/common";
import { audit } from "@/server/services/audit";

type AdminActor = { id: string; ip?: string | null };

// ───────────────────────────── Customers ─────────────────────────────

export async function listCustomers(
  f: { q?: string; status?: "ACTIVE" | "DISABLED"; page: number },
  pageSize = 20,
) {
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
    ...(f.status ? { status: f.status } : {}),
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: "insensitive" } },
            { email: { contains: f.q, mode: "insensitive" } },
            { phone: { contains: f.q } },
          ],
        }
      : {}),
  };
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    }),
  ]);
  const ids = users.map((u) => u.id);
  const spend = ids.length
    ? await db.order.groupBy({
        by: ["userId"],
        where: { userId: { in: ids }, status: { notIn: ["CANCELLED", "PENDING"] } },
        _sum: { totalPaise: true },
      })
    : [];
  const spendMap = new Map(spend.map((s) => [s.userId, s._sum.totalPaise ?? 0]));
  return {
    total,
    customers: users.map((u) => ({ ...u, totalSpentPaise: spendMap.get(u.id) ?? 0 })),
    page: f.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomer(id: string) {
  const user = await db.user.findFirst({
    where: { id, role: "CUSTOMER" },
    include: {
      addresses: true,
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          totalPaise: true,
          createdAt: true,
        },
      },
      sessions: { select: { id: true } },
    },
  });
  if (!user) throw new AppError("NOT_FOUND", "Customer not found");
  return user;
}

/** Disabling an account blocks sign-in and revokes all active sessions immediately. */
export async function setCustomerStatus(
  id: string,
  status: "ACTIVE" | "DISABLED",
  actor: AdminActor,
) {
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.role !== "CUSTOMER") throw new AppError("NOT_FOUND", "Customer not found");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status } });
    if (status === "DISABLED") await tx.session.deleteMany({ where: { userId: id } });
    await audit(
      {
        actorId: actor.id,
        action: status === "DISABLED" ? "customer.disable" : "customer.enable",
        entityType: "User",
        entityId: id,
        ipAddress: actor.ip,
      },
      tx,
    );
  });
}

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

// ───────────────────────────── Store settings ─────────────────────────────

const paise = z.coerce.number().int().min(0).max(100_000_000);

export const settingsSchema = z
  .object({
    storeName: trimmed(2, 80, "Store name"),
    legalName: optionalTrimmed(120),
    logoUrl: optionalTrimmed(500),
    supportEmail: emailSchema,
    supportPhone: optionalTrimmed(20),
    addressLine1: optionalTrimmed(120),
    addressLine2: optionalTrimmed(120),
    city: optionalTrimmed(60),
    stateCode: z.enum(STATE_CODES),
    pincode: z
      .string()
      .trim()
      .regex(/^[1-9]\d{5}$/, "Enter a valid PIN code")
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    gstEnabled: z.boolean(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .nullable()
      .optional()
      .or(z.literal("").transform(() => null)),
    pricesIncludeTax: z.boolean(),
    defaultTaxRateBps: z.coerce
      .number()
      .int()
      .refine((v) => [0, 500, 1200, 1800, 2800].includes(v), "Choose a valid GST rate"),
    shippingFlatPaise: paise,
    freeShippingThresholdPaise: paise.nullable(),
    codEnabled: z.boolean(),
    codFeePaise: paise,
    codMinOrderPaise: paise,
    codMaxOrderPaise: paise.nullable(),
    codBlockedPincodes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[1-9]\d{5}$/, "Invalid PIN code"),
      )
      .max(5000)
      .default([]),
    minOrderPaise: paise,
    orderPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,6}$/, "2–6 letters"),
    invoicePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,6}$/, "2–6 letters"),
    lowStockThreshold: z.coerce.number().int().min(0).max(10_000),
  })
  .superRefine((s, ctx) => {
    if (s.gstEnabled && !s.gstin)
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "GSTIN is required when GST is enabled",
      });
    if (s.gstin && !isValidGstin(s.gstin))
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "Enter a valid 15-character GSTIN",
      });
    if (s.codMaxOrderPaise !== null && s.codMaxOrderPaise < s.codMinOrderPaise) {
      ctx.addIssue({
        code: "custom",
        path: ["codMaxOrderPaise"],
        message: "Maximum must be above the minimum",
      });
    }
  });
export type SettingsInput = z.infer<typeof settingsSchema>;

export async function updateSettings(input: SettingsInput, actor: AdminActor) {
  if (input.gstin) {
    const expected = INDIAN_STATES.find((s) => s.code === input.stateCode)?.gst;
    if (expected && input.gstin.slice(0, 2) !== expected) {
      throw new AppError("VALIDATION_ERROR", "GSTIN state code does not match the store state", {
        gstin: "GSTIN does not match the selected state",
      });
    }
  }
  const before = await db.storeSettings.findUnique({ where: { id: "default" } });
  const settings = await db.storeSettings.upsert({
    where: { id: "default" },
    update: input,
    create: { id: "default", ...input },
  });
  const changed = before
    ? Object.keys(input).filter(
        (k) =>
          JSON.stringify((before as Record<string, unknown>)[k]) !==
          JSON.stringify((input as Record<string, unknown>)[k]),
      )
    : Object.keys(input);
  await audit({
    actorId: actor.id,
    action: "settings.update",
    entityType: "StoreSettings",
    entityId: "default",
    metadata: { changed },
    ipAddress: actor.ip,
  });
  return settings;
}
