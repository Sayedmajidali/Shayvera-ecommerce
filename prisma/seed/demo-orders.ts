/**
 * Generates realistic order history for local development using the real services
 * (cart → checkout → status transitions), then backdates timestamps across the last 60 days.
 */
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/platform/db";
import { checkoutSchema } from "../../src/lib/validation/checkout";
import { addItem, type CartIdentity } from "../../src/server/modules/cart/cart";
import { placeOrder } from "../../src/server/modules/checkout/checkout";
import { transitionOrder } from "../../src/server/modules/orders/orders";

const CUSTOMERS = [
  {
    name: "Ananya Iyer",
    email: "customer@shayvera.local",
    phone: "9845012345",
    city: "Bengaluru",
    stateCode: "KA",
    pincode: "560038",
  },
  {
    name: "Rohan Mehta",
    email: "rohan.mehta@example.com",
    phone: "9820012345",
    city: "Mumbai",
    stateCode: "MH",
    pincode: "400050",
  },
  {
    name: "Priya Sharma",
    email: "priya.sharma@example.com",
    phone: "9811012345",
    city: "New Delhi",
    stateCode: "DL",
    pincode: "110017",
  },
  {
    name: "Karthik Rao",
    email: "karthik.rao@example.com",
    phone: "9884012345",
    city: "Chennai",
    stateCode: "TN",
    pincode: "600041",
  },
  {
    name: "Meera Nair",
    email: "meera.nair@example.com",
    phone: "9847012345",
    city: "Kochi",
    stateCode: "KL",
    pincode: "682020",
  },
  {
    name: "Arjun Singh",
    email: "arjun.singh@example.com",
    phone: "9876012345",
    city: "Jaipur",
    stateCode: "RJ",
    pincode: "302001",
  },
];

export async function seedDemoOrders(count = 45) {
  if ((await db.order.count()) > 0) return 0;
  const variants = await db.productVariant.findMany({
    where: {
      isActive: true,
      product: { status: "ACTIVE" },
      inventory: { quantityOnHand: { gt: 5 } },
    },
    select: { id: true },
  });
  if (variants.length === 0) return 0;
  const user = await db.user.findUnique({ where: { email: CUSTOMERS[0]!.email } });
  let created = 0;
  for (let i = 0; i < count; i++) {
    const c = CUSTOMERS[i % CUSTOMERS.length]!;
    let identity: CartIdentity =
      i % CUSTOMERS.length === 0 && user ? { userId: user.id } : { guestToken: null };
    const lines = 1 + (i % 3);
    for (let l = 0; l < lines; l++) {
      const v = variants[(i * 7 + l * 3) % variants.length]!;
      const r = await addItem(identity, v.id, 1 + ((i + l) % 2));
      if (r.createdToken) identity = { guestToken: r.createdToken };
    }
    try {
      const input = checkoutSchema.parse({
        idempotencyKey: randomUUID(),
        email: c.email,
        phone: c.phone,
        shippingAddress: {
          fullName: c.name,
          phone: c.phone,
          line1: `${10 + i} Park Street`,
          city: c.city,
          stateCode: c.stateCode,
          pincode: c.pincode,
        },
        paymentMethod: "COD",
      });
      const res = await placeOrder(input, {
        identity,
        userId: "userId" in identity ? identity.userId : null,
      });
      const daysAgo = Math.floor((i / count) * 58) + (i % 3);
      const placedAt = new Date(Date.now() - daysAgo * 86_400_000 - (i % 9) * 3_600_000);
      const path =
        daysAgo > 7
          ? i % 11 === 0
            ? ["CANCELLED"]
            : ["PROCESSING", "SHIPPED", "DELIVERED"]
          : daysAgo > 3
            ? ["PROCESSING", "SHIPPED"]
            : [];
      for (const to of path) {
        await db.$transaction(async (tx) => {
          if (to === "SHIPPED")
            await tx.shipment.create({
              data: {
                orderId: res.orderId,
                carrier: "Delhivery",
                trackingNumber: `DL${100000 + i}`,
                status: "SHIPPED",
                shippedAt: placedAt,
              },
            });
          await transitionOrder(tx, {
            orderId: res.orderId,
            to: to as "SHIPPED",
            actor: { type: "SYSTEM" },
            note: "Demo data",
          });
        });
      }
      await db.order.update({
        where: { id: res.orderId },
        data: { placedAt, createdAt: placedAt },
      });
      await db.orderStatusHistory.updateMany({
        where: { orderId: res.orderId },
        data: { createdAt: placedAt },
      });
      created++;
    } catch (error) {
      console.warn("Skipped a demo order:", error instanceof Error ? error.message : error);
    }
  }
  return created;
}
