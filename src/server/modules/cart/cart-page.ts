import "server-only";
import { getCurrentUser } from "@/server/modules/auth/session";
import { readGuestToken } from "@/server/modules/cart/identity";
import { getCartView, type CartIdentity } from "@/server/modules/cart/cart";

export async function currentCartIdentity(): Promise<{
  identity: CartIdentity;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
}> {
  const user = await getCurrentUser();
  return { identity: user ? { userId: user.id } : { guestToken: await readGuestToken() }, user };
}

export async function getCurrentCartView(opts?: {
  buyNow?: { variantId: string; quantity: number };
}) {
  const { identity, user } = await currentCartIdentity();
  return {
    view: await getCartView(identity, { email: user?.email ?? null, buyNow: opts?.buyNow }),
    user,
  };
}
