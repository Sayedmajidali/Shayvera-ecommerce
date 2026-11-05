import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/store/auth-card";
import { ForgotPasswordForm } from "@/components/store/auth-forms";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you used to sign up and we’ll send you a reset link."
      footer={
        <Link href="/login" className="underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
