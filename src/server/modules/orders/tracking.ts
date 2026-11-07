import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { db } from "@/server/platform/db";
import { orderTrackToken, verifyOrderTrackToken } from "@/server/modules/orders/order-access";

export const trackLookupSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}\d{4,12}$/, "Enter the order number from your confirmation email"),
  contact: z.string().trim().min(5, "Enter the email or mobile number used for the order").max(120),
});

const NOT_FOUND =
  "We couldn’t find an order with those details. Check the order number and email or phone.";

const digits = (s: string) => s.replace(/\D/g, "").slice(-10);

/**
 * Matches an order by number + the email or phone it was placed with, and returns a read-only
 * tracking token. The same generic error is returned for every mismatch so it cannot be used to
 * discover order numbers or contact details.
 */
export async function lookupOrderForTracking(input: z.infer<typeof trackLookupSchema>) {
  const { orderNumber, contact } = trackLookupSchema.parse(input);
  const order = await db.order.findUnique({
    where: { orderNumber },
    select: { id: true, orderNumber: true, email: true, phone: true },
  });
  const isEmail = contact.includes("@");
  const matches =
    order &&
    (isEmail
      ? order.email.toLowerCase() === contact.toLowerCase()
      : digits(contact).length === 10 && digits(order.phone) === digits(contact));
  if (!matches) throw new AppError("NOT_FOUND", NOT_FOUND);
  return { orderNumber: order.orderNumber, token: orderTrackToken(order.id) };
}

/** Customer-safe tracking data: no addresses, contact details, payments or notes. */
export async function getTrackingView(orderNumber: string, token: string | null) {
  const order = await db.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      placedAt: true,
      paymentMethod: true,
      totalPaise: true,
      items: {
        select: { id: true, productName: true, variantName: true, quantity: true, imageUrl: true },
      },
      statusHistory: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
      shipments: {
        where: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          carrier: true,
          trackingNumber: true,
          trackingUrl: true,
          status: true,
          etd: true,
          shippedAt: true,
          deliveredAt: true,
          events: {
            where: { status: { not: null } },
            orderBy: { occurredAt: "desc" },
            take: 15,
            select: { id: true, status: true, activity: true, location: true, occurredAt: true },
          },
        },
      },
    },
  });
  if (!order || !verifyOrderTrackToken(order.id, token)) return null;
  const { id: _id, ...view } = order;
  void _id;
  return view;
}
