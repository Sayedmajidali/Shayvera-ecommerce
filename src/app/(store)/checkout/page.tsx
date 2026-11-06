import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/store/checkout-form";
import { isOnlinePaymentConfigured } from "@/server/modules/payments/gateway";
import { getCurrentCartView } from "@/server/modules/cart/cart-page";
import { getStoreSettings } from "@/server/modules/settings/queries";
import { listAddresses } from "@/server/modules/customers/account";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const [{ view, user }, settings] = await Promise.all([getCurrentCartView(), getStoreSettings()]);
  if (view.lines.length === 0 || view.issues.length > 0) redirect("/cart");
  const addresses = user ? await listAddresses(user.id) : [];
  return (
    <div className="container-page py-10">
      <h1 className="heading-display text-4xl">Checkout</h1>
      <div className="mt-8">
        <CheckoutForm
          initialView={view}
          user={user ? { name: user.name, email: user.email, phone: user.phone } : null}
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
        />
      </div>
    </div>
  );
}
