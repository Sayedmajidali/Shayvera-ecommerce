import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import { renderOrderEmail } from "@/server/modules/notifications/order-emails";
import { makeProduct } from "../helpers/fixtures";
import { cartWith, checkout, checkoutBody } from "../helpers/checkout";

async function placeOrder(price: number, qty = 1) {
  const p = await makeProduct({ name: "Jeera Makhana", price, stock: 10 });
  const cookie = await cartWith(p.variants[0]!.id, qty);
  const { json } = await checkout(cookie, checkoutBody());
  return db.order.findUniqueOrThrow({ where: { orderNumber: json.data.orderNumber } });
}

describe("order emails (branded layout)", () => {
  it("confirmation shows greeting, items, full price breakdown, address, ETA and a button", async () => {
    const order = await placeOrder(11_500); // ₹115 → ₹99 shipping + ₹49 COD fee
    await db.order.update({ where: { id: order.id }, data: { deliveryEtaDays: 4 } });
    const m = (await renderOrderEmail(order.id, "confirmed"))!;

    expect(m.subject).toBe(`Order ${order.orderNumber} confirmed`);
    expect(m.text).toContain("Hi Asha,");
    expect(m.text).toContain("Subtotal: ₹115");
    expect(m.text).toContain("Shipping: ₹99");
    expect(m.text).toContain("Cash on Delivery fee: ₹49");
    expect(m.text).toContain("To pay on delivery: ₹263");
    expect(m.text).toContain("12 MG Road, Ashok Nagar");
    expect(m.text).toContain("Bengaluru, Karnataka, 560001");
    expect(m.text).toMatch(/Expected delivery: by \w{3}, \d{1,2} \w{3}/);

    const html = m.html!;
    expect(html).toContain("/brand/email-logo.png"); // PNG logo (Gmail/Outlook do not show SVG)
    expect(html).toContain("Your order is confirmed");
    expect(html).toContain("Hi Asha,");
    expect(html).toContain("Expected delivery: by");
    expect(html).toContain('bgcolor="#0c764e"'); // bulletproof green button
    expect(html).toContain("View your order");
    expect(html).toContain("Delivering to");
    expect(html).toMatch(/max-width:600px/);
    expect(html).not.toMatch(/<style|<script/i); // inline styles only
  });

  it("free shipping shows as Free; no ETA line once the estimate has passed", async () => {
    const order = await placeOrder(60_000, 2); // ₹1,200 ≥ ₹999 → free shipping
    await db.order.update({
      where: { id: order.id },
      data: { deliveryEtaDays: 2, placedAt: new Date(Date.now() - 10 * 86_400_000) },
    });
    const m = (await renderOrderEmail(order.id, "confirmed"))!;
    expect(m.text).toContain("Shipping: Free");
    expect(m.text).not.toContain("Expected delivery");
    expect(m.html).toContain("We’ll email you the tracking details as soon as your order ships.");
  });

  it("escapes customer-provided text", async () => {
    const order = await placeOrder(11_500);
    await db.order.update({
      where: { id: order.id },
      data: { shippingAddress: { ...(order.shippingAddress as object), fullName: "<b>Eve</b> X" } },
    });
    const m = (await renderOrderEmail(order.id, "confirmed"))!;
    expect(m.html).not.toContain("<b>Eve</b>");
    expect(m.html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
  });
});
