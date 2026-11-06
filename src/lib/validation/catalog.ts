import { z } from "zod";
import { optionalTrimmed, slugSchema, trimmed } from "@/lib/validation/common";

const paise = (label: string) =>
  z.coerce
    .number({ error: `${label} is required` })
    .int(`${label} must be in whole paise`)
    .min(0, `${label} cannot be negative`)
    .max(100_000_000, `${label} is too large`);

const mm = (label: string) =>
  z.coerce
    .number()
    .int(`${label} must be whole millimetres`)
    .min(1, `${label} must be positive`)
    .max(2000, `${label} is too large`)
    .nullable()
    .optional();

/** Specification rows shown on the product page, in order. */
export const attributesSchema = z
  .array(
    z.object({
      name: trimmed(1, 60, "Attribute name"),
      value: trimmed(1, 300, "Attribute value"),
    }),
  )
  .max(30, "At most 30 specifications")
  .refine(
    (rows) => new Set(rows.map((r) => r.name.toLowerCase())).size === rows.length,
    "Each specification name can be used once",
  );
export type AttributeInput = z.infer<typeof attributesSchema>;

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
    // Packed shipping weight (g) and box (mm). Empty = use the store default package.
    weightGrams: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
    lengthMm: mm("Length"),
    breadthMm: mm("Breadth"),
    heightMm: mm("Height"),
    isActive: z.boolean().default(true),
    initialStock: z.coerce.number().int().min(0).max(1_000_000).optional(),
    lowStockThreshold: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => !v.compareAtPricePaise || v.compareAtPricePaise > v.pricePaise, {
    message: "Compare-at price must be higher than the price",
    path: ["compareAtPricePaise"],
  })
  .refine(
    (v) => {
      const set = [v.lengthMm, v.breadthMm, v.heightMm].filter((x) => x != null).length;
      return set === 0 || set === 3;
    },
    { message: "Enter all three box dimensions or none", path: ["lengthMm"] },
  );
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
  // Food labelling information shown on the product page.
  ingredients: optionalTrimmed(2000),
  shelfLife: optionalTrimmed(100),
  storageInfo: optionalTrimmed(300),
  countryOfOrigin: z.string().trim().min(2, "Country of origin is required").max(60).optional(),
  isVegetarian: z.boolean().optional(),
  seoTitle: optionalTrimmed(70),
  seoDescription: optionalTrimmed(160),
  attributes: attributesSchema.optional(),
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
