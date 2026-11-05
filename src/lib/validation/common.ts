import { z } from "zod";
import {
  STATE_CODES,
  isValidIndianMobile,
  isValidPincode,
  normalizeIndianPhone,
} from "@/lib/india";

export const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

export const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

export const indianPhoneSchema = z
  .string({ error: "Mobile number is required" })
  .trim()
  .refine(isValidIndianMobile, "Enter a valid 10-digit Indian mobile number")
  .transform(normalizeIndianPhone);

export const pincodeSchema = z
  .string({ error: "PIN code is required" })
  .trim()
  .refine(isValidPincode, "Enter a valid 6-digit PIN code");

export const stateCodeSchema = z.enum(STATE_CODES, { error: "Select a state" });

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use at least one letter and one number");

export const idSchema = z.string().trim().min(1).max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only");

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
