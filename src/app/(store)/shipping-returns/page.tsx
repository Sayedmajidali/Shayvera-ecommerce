import type { Metadata } from "next";
import { LegalPage } from "@/components/store/legal-page";
import { formatINR } from "@/lib/money";
import { getStoreSettings } from "@/server/queries/settings";

export const metadata: Metadata = {
  title: "Shipping and returns",
  alternates: { canonical: "/shipping-returns" },
};

export default async function ShippingReturnsPage() {
  const s = await getStoreSettings();
  return (
    <LegalPage title="Shipping & returns" updated="5 November 2026">
      <h2>Shipping</h2>
      <ul>
        <li>We ship across India. Orders are dispatched within 1–2 business days.</li>
        <li>Standard delivery takes 3–7 business days depending on your PIN code.</li>
        <li>
          Shipping costs {formatINR(s.shippingFlatPaise)} per order
          {s.freeShippingThresholdPaise !== null && (
            <>, and is free on orders above {formatINR(s.freeShippingThresholdPaise)}</>
          )}
          .
        </li>
        <li>
          You will receive tracking details once your order has shipped; you can also see them under
          My orders.
        </li>
      </ul>
      <h2>Cash on Delivery</h2>
      <p>
        {s.codEnabled
          ? `COD is available on eligible orders${s.codFeePaise > 0 ? ` with a handling fee of ${formatINR(s.codFeePaise)}` : ""}${s.codMaxOrderPaise ? ` up to ${formatINR(s.codMaxOrderPaise)}` : ""}.`
          : "Cash on Delivery is currently unavailable."}
      </p>
      <h2>Returns</h2>
      <ul>
        <li>Unused items in original packaging can be returned within 7 days of delivery.</li>
        <li>
          Damaged or incorrect items: email us photos within 48 hours of delivery and we’ll replace
          or refund at no cost.
        </li>
        <li>
          Personal-care items (soaps, oils) cannot be returned once opened, for hygiene reasons.
        </li>
      </ul>
      <h2>Refunds</h2>
      <p>
        Approved refunds for online payments are issued to the original payment method within 5–7
        business days. COD refunds are made by bank transfer.
      </p>
      <h2>Cancellations</h2>
      <p>
        You can cancel an order before it ships from your account or by contacting us at{" "}
        {s.supportEmail}.
      </p>
    </LegalPage>
  );
}
