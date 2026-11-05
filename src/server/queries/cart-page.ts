import "server-only";
import { getCurrentUser } from "@/server/auth/session";
import { readGuestToken } from "@/server/cart/identity";
import { getCartView, type CartIdentity } from "@/server/services/cart";

export async function currentCartIdentity(): Promise<{
  identity: CartIdentity;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
}> {
  const user = await getCurrentUser();
  return { identity: user ? { userId: user.id } : { guestToken: await readGuestToken() }, user };
}

export async function getCurrentCartView() {
  const { identity, user } = await currentCartIdentity();
  return { view: await getCartView(identity, { email: user?.email ?? null }), user };
}
