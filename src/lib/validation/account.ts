import { z } from "zod";
import {
  indianPhoneSchema,
  optionalTrimmed,
  pincodeSchema,
  stateCodeSchema,
  trimmed,
} from "@/lib/validation/common";

export const profileUpdateSchema = z.object({
  name: trimmed(2, 80, "Name"),
  phone: z
    .union([indianPhoneSchema, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
});

export const addressInputSchema = z.object({
  label: optionalTrimmed(40),
  fullName: trimmed(2, 80, "Full name"),
  phone: indianPhoneSchema,
  line1: trimmed(3, 120, "Address line 1"),
  line2: optionalTrimmed(120),
  landmark: optionalTrimmed(80),
  city: trimmed(2, 60, "City"),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
  isDefault: z.boolean().optional().default(false),
});

export type AddressInput = z.infer<typeof addressInputSchema>;
export type AddressSnapshot = Omit<AddressInput, "isDefault" | "label">;
