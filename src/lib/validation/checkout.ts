import { z } from "zod";
import { addressInputSchema } from "@/lib/validation/account";
import { emailSchema, indianPhoneSchema, optionalTrimmed } from "@/lib/validation/common";

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
  })
  .refine((v) => v.billingSameAsShipping || v.billingAddress, {
    message: "Billing address is required",
    path: ["billingAddress"],
  });
export type CheckoutInput = z.infer<typeof checkoutSchema>;
