import type { Metadata } from "next";
import { LegalPage } from "@/components/store/legal-page";
import { getStoreSettings } from "@/server/queries/settings";

export const metadata: Metadata = {
  title: "Privacy policy",
  alternates: { canonical: "/privacy" },
};

export default async function PrivacyPage() {
  const s = await getStoreSettings();
  return (
    <LegalPage title="Privacy policy" updated="5 November 2026">
      <p>
        This policy explains how {s.legalName ?? s.storeName} collects, uses and protects your
        personal data when you use this website, in line with the Digital Personal Data Protection
        Act, 2023.
      </p>
      <h2>Information we collect</h2>
      <ul>
        <li>
          Account details: name, email address, mobile number and password (stored only as a secure
          hash).
        </li>
        <li>Order details: shipping and billing addresses, items purchased and payment status.</li>
        <li>
          Payment information is processed by Razorpay. We never see or store your card number, CVV
          or UPI PIN.
        </li>
        <li>
          Technical data such as IP address and browser type, used for security and fraud
          prevention.
        </li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To process and deliver your orders and provide customer support.</li>
        <li>To send transactional messages about your orders and account.</li>
        <li>To send marketing emails only if you subscribe; you can unsubscribe at any time.</li>
        <li>To meet legal obligations, including tax and accounting requirements.</li>
      </ul>
      <h2>Sharing</h2>
      <p>
        We share data only with service providers needed to run the store — payment processors,
        courier partners and hosting providers — under appropriate confidentiality obligations. We
        do not sell your data.
      </p>
      <h2>Your rights</h2>
      <p>
        You may access, correct or request deletion of your personal data by writing to{" "}
        {s.supportEmail}. Order records may be retained as required by law.
      </p>
      <h2>Cookies</h2>
      <p>
        We use essential cookies to keep you signed in and remember your cart. We do not use
        third-party advertising cookies.
      </p>
    </LegalPage>
  );
}
