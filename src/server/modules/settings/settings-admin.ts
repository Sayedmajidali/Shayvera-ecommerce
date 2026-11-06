import { z } from "zod";
import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { INDIAN_STATES, isValidGstin, STATE_CODES } from "@/lib/india";
import { emailSchema, optionalTrimmed, trimmed } from "@/lib/validation/common";
import { audit } from "@/server/modules/audit/audit";

type AdminActor = { id: string; ip?: string | null };

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
    fssaiLicense: z
      .string()
      .trim()
      .regex(/^\d{14}$/, "FSSAI licence numbers are 14 digits")
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
    // Default packed weight/box for shipping quotes when a variant has none (omit to keep).
    defaultPackageWeightGrams: z.coerce
      .number()
      .int()
      .min(1, "Must be positive")
      .max(100_000)
      .optional(),
    defaultPackageLengthMm: z.coerce.number().int().min(1, "Must be positive").max(2000).optional(),
    defaultPackageBreadthMm: z.coerce
      .number()
      .int()
      .min(1, "Must be positive")
      .max(2000)
      .optional(),
    returnWindowDays: z.coerce.number().int().min(0).max(60).optional(),
    defaultPackageHeightMm: z.coerce.number().int().min(1, "Must be positive").max(2000).optional(),
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
