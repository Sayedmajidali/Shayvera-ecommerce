import { z } from "zod";
import { optionalTrimmed, slugSchema, trimmed } from "@/lib/validation/common";

const paise = (label: string) =>
  z.coerce
    .number({ error: `${label} is required` })
    .int(`${label} must be in whole paise`)
    .min(0, `${label} cannot be negative`)
    .max(100_000_000, `${label} is too large`);

const GST_RATES_BPS = [0, 25, 300, 500, 1200, 1800, 2800, 4000] as const;

export const categoryInputSchema = z.object({
  name: trimmed(2, 80, "Name"),
  slug: slugSchema.optional(),
  description: optionalTrimmed(500),
  parentId: z.string().trim().min(1).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  imageUrl: optionalTrimmed(500),
  seoTitle: optionalTrimmed(70),
  seoDescription: optionalTrimmed(160),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const optionsSchema = z
  .record(z.string().trim().min(1).max(30), z.string().trim().min(1).max(60))
  .refine((o) => Object.keys(o).length <= 3, "At most 3 options per variant")
  .default({});

export const variantInputSchema = z
  .object({
    id: z.string().optional(),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, "SKU is required")
      .max(40)
      .regex(/^[A-Z0-9][A-Z0-9-_]*$/, "SKU may contain letters, numbers, - and _"),
    name: trimmed(1, 80, "Variant name"),
    options: optionsSchema,
    pricePaise: paise("Price").refine((v) => v >= 100, "Price must be at least ₹1"),
    compareAtPricePaise: paise("Compare-at price").nullable().optional(),
    weightGrams: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    isActive: z.boolean().default(true),
    initialStock: z.coerce.number().int().min(0).max(1_000_000).optional(),
    lowStockThreshold: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => !v.compareAtPricePaise || v.compareAtPricePaise > v.pricePaise, {
    message: "Compare-at price must be higher than the price",
    path: ["compareAtPricePaise"],
  });
export type VariantInput = z.infer<typeof variantInputSchema>;

const productBase = z.object({
  name: trimmed(2, 120, "Name"),
  slug: slugSchema.optional(),
  shortDescription: optionalTrimmed(200),
  description: trimmed(10, 10_000, "Description"),
  brand: optionalTrimmed(80),
  categoryId: z.string().trim().min(1, "Category is required"),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  isFeatured: z.boolean().default(false),
  taxRateBps: z.coerce
    .number()
    .int()
    .refine((v) => (GST_RATES_BPS as readonly number[]).includes(v), "Choose a valid GST rate")
    .nullable()
    .optional(),
  hsnCode: z
    .string()
    .trim()
    .regex(/^(\d{4}|\d{6}|\d{8})$/, "HSN must be 4, 6 or 8 digits")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  seoTitle: optionalTrimmed(70),
  seoDescription: optionalTrimmed(160),
});

export const productCreateSchema = productBase.extend({
  variants: z.array(variantInputSchema).min(1, "Add at least one variant").max(50),
});
export const productUpdateSchema = productBase.partial();
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const imageUpdateSchema = z.object({ alt: z.string().trim().max(160) });
export const imageReorderSchema = z.object({ order: z.array(z.string().min(1)).min(1).max(30) });

export const stockAdjustmentSchema = z.object({
  delta: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, "Adjustment cannot be zero")
    .refine((v) => Math.abs(v) <= 100_000, "Adjustment too large"),
  reason: z.enum(["ADJUSTMENT", "RESTOCK", "DAMAGE", "RETURN", "CORRECTION"]),
  note: optionalTrimmed(200),
});

export const GST_RATE_OPTIONS = GST_RATES_BPS;
