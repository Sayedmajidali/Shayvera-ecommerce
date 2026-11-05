import "server-only";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { readGuestToken } from "@/server/cart/identity";

export async function getCartItemCount(): Promise<number> {
  const user = await getCurrentUser();
  const where = user ? { userId: user.id } : { guestToken: (await readGuestToken()) ?? "__none__" };
  const cart = await db.cart.findFirst({
    where,
    select: { items: { select: { quantity: true } } },
  });
  return cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;
}
