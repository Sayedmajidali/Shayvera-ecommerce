import { z } from "zod";
import { addressInputSchema } from "@/lib/validation/account";
import { emailSchema, idSchema, indianPhoneSchema, optionalTrimmed } from "@/lib/validation/common";

/** A single item bought directly from the product page ("Buy now"). */
export const buyNowSchema = z.object({
  variantId: idSchema,
  quantity: z.coerce.number().int().min(1).max(10),
});
export type BuyNowInput = z.infer<typeof buyNowSchema>;

export const couponCodeInput = z
  .string()
  .trim()
  .max(40)
  .transform((v) => v.toUpperCase())
  .optional()
  .nullable()
  .transform((v) => v || null);

export const addressSnapshotSchema = addressInputSchema.omit({ isDefault: true, label: true });
export type AddressSnapshot = z.infer<typeof addressSnapshotSchema>;

export const checkoutSchema = z
  .object({
    idempotencyKey: z.uuid("Invalid checkout session"),
    email: emailSchema,
    phone: indianPhoneSchema,
    shippingAddress: addressSnapshotSchema,
    billingSameAsShipping: z.boolean().default(true),
    billingAddress: addressSnapshotSchema.optional().nullable(),
    paymentMethod: z.enum(["COD", "RAZORPAY"]),
    customerNote: optionalTrimmed(500),
    saveAddress: z.boolean().optional().default(false),
    /** When present, only this item is ordered and the cart is left untouched. */
    buyNow: buyNowSchema.optional().nullable(),
    /** Coupon for a "Buy now" checkout (cart checkouts use the coupon saved on the cart). */
    couponCode: couponCodeInput,
  })
  .refine((v) => v.billingSameAsShipping || v.billingAddress, {
    message: "Billing address is required",
    path: ["billingAddress"],
  });
export type CheckoutInput = z.infer<typeof checkoutSchema>;
