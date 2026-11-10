import type { Metadata } from "next";
import { PageIntro } from "@/components/store/page-intro";
import { TrackOrderForm } from "@/components/store/track-order-form";

export const metadata: Metadata = {
  title: "Track your order",
  description: "Check the status of your Shayvera Food order with your order number.",
  alternates: { canonical: "/track" },
};

export default function TrackPage() {
  return (
    <div className="container-page max-w-xl py-12">
      <PageIntro eyebrow="Orders" title="Track your order">
        Enter the order number from your confirmation email and the email or mobile number you
        ordered with.
      </PageIntro>
      <div className="bg-card mt-8 rounded-2xl border p-6">
        <TrackOrderForm />
      </div>
    </div>
  );
}
