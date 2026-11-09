import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/store/checkout-form";
import { CheckoutProgress } from "@/components/bits/checkout-progress";
import { isPlaceholderEmail } from "@/lib/india";
import { isOnlinePaymentConfigured } from "@/server/modules/payments/gateway";
import { getCurrentCartView } from "@/server/modules/cart/cart-page";
import { getStoreSettings } from "@/server/modules/settings/queries";
import { listAddresses } from "@/server/modules/customers/account";
import { firstValues } from "@/lib/search-params";
import { buyNowSchema } from "@/lib/validation/checkout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const sp = firstValues(await searchParams);
  const buy = sp.buy ? buyNowSchema.safeParse({ variantId: sp.buy, quantity: sp.qty ?? 1 }) : null;
  const buyNow = buy?.success ? buy.data : null;
  const [{ view, user }, settings] = await Promise.all([
    getCurrentCartView(buyNow ? { buyNow } : undefined),
    getStoreSettings(),
  ]);
  if (buyNow && (view.lines.length === 0 || view.issues.length > 0)) {
    // Product unavailable or not enough stock: back to the product page (or shop).
    const slug = view.lines[0]?.productSlug;
    redirect(slug ? `/product/${slug}?unavailable=1` : "/shop");
  }
  if (view.lines.length === 0 || view.issues.length > 0) redirect("/cart");
  const addresses = user ? await listAddresses(user.id) : [];
  return (
    <div className="container-page py-10">
      <h1 className="heading-display text-4xl">Checkout</h1>
      <div className="mt-6">
        <CheckoutProgress />
        <CheckoutForm
          initialView={view}
          user={
            user
              ? {
                  name: user.name === user.phoneNumber ? "" : user.name,
                  email: isPlaceholderEmail(user.email) ? "" : user.email,
                  phone: user.phone,
                }
              : null
          }
          savedAddresses={addresses.map((a) => ({
            id: a.id,
            fullName: a.fullName,
            phone: a.phone,
            line1: a.line1,
            line2: a.line2 ?? "",
            landmark: a.landmark ?? "",
            city: a.city,
            stateCode: a.stateCode,
            pincode: a.pincode,
            isDefault: a.isDefault,
          }))}
          codEnabled={settings.codEnabled}
          onlineEnabled={isOnlinePaymentConfigured()}
          codFeePaise={settings.codFeePaise}
          buyNow={buyNow}
        />
      </div>
    </div>
  );
}
