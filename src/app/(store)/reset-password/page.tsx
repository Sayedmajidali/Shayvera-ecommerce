import type { Metadata } from "next";
import { AuthCard } from "@/components/store/auth-card";
import { ResetPasswordForm } from "@/components/store/auth-forms";
import { firstValues } from "@/lib/search-params";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const sp = firstValues(await searchParams);
  const token = sp.error ? null : (sp.token ?? null);
  // Staff invitations use the same flow (Admin → Staff → Invite).
  const invite = sp.invite === "1";
  return (
    <AuthCard title={invite ? "Set your password" : "Choose a new password"}>
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
