import type { Metadata } from "next";
import { LegalPage } from "@/components/store/legal-page";
import { getStoreSettings } from "@/server/queries/settings";

export const metadata: Metadata = {
  title: "Terms and conditions",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const s = await getStoreSettings();
  return (
    <LegalPage title="Terms and conditions" updated="5 November 2026">
      <p>
        By using this website and placing an order with {s.legalName ?? s.storeName}, you agree to
        these terms.
      </p>
      <h2>Products and pricing</h2>
      <p>
        All prices are in Indian Rupees (INR) and include applicable taxes unless stated otherwise.
        We make every effort to display products accurately; natural products may vary slightly in
        colour, size and aroma from batch to batch.
      </p>
      <h2>Orders</h2>
      <p>
        An order is confirmed when you receive an order confirmation. We may cancel an order if an
        item is unavailable, a pricing error has occurred, or we suspect fraud; any payment received
        will be refunded in full.
      </p>
      <h2>Payments</h2>
      <p>
        Online payments are processed securely by Razorpay. Cash on Delivery is available for
        eligible orders and PIN codes and may carry an additional fee shown at checkout.
      </p>
      <h2>Accounts</h2>
      <p>
        You are responsible for keeping your password confidential and for activity under your
        account.
      </p>
      <h2>Liability</h2>
      <p>
        To the extent permitted by law, our liability for any claim relating to an order is limited
        to the amount paid for that order.
      </p>
      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of India. Courts at {s.city ?? "our registered city"}{" "}
        shall have exclusive jurisdiction.
      </p>
    </LegalPage>
  );
}
