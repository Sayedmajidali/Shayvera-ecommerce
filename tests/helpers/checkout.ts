import { randomUUID } from "node:crypto";
import * as checkoutRoute from "@/app/api/checkout/route";
import * as itemsRoute from "@/app/api/cart/items/route";
import { apiRequest } from "./auth";

export const address = {
  fullName: "Asha Rao",
  phone: "9845012345",
  line1: "12 MG Road",
  line2: "Ashok Nagar",
  city: "Bengaluru",
  stateCode: "KA",
  pincode: "560001",
};

export function checkoutBody(o: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    email: "buyer@example.com",
    phone: "9845012345",
    shippingAddress: address,
    billingSameAsShipping: true,
    paymentMethod: "COD",
    ...o,
  };
}

/** Adds a variant to a (possibly new) guest cart, returning the cart cookie. */
export async function cartWith(variantId: string, quantity = 1, cookie?: string) {
  const res = await itemsRoute.POST(
    apiRequest("/api/cart/items", { method: "POST", cookie, body: { variantId, quantity } }),
    undefined,
  );
  if (res.status !== 201) throw new Error(`add to cart failed: ${res.status} ${await res.text()}`);
  const set = res.headers.get("set-cookie");
  return set ? set.split(";")[0]! : cookie!;
}

export async function checkout(cookie: string | undefined, body: Record<string, unknown>) {
  const res = await checkoutRoute.POST(
    apiRequest("/api/checkout", { method: "POST", cookie, body }),
    undefined,
  );
  return { res, json: await res.json() };
}
