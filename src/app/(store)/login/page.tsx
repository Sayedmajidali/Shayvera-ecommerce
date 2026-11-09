import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/store/auth-card";
import { LoginForm } from "@/components/store/auth-forms";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { SignInMethods } from "@/components/store/sign-in-methods";
import { firstValues } from "@/lib/search-params";
import { getCurrentUser } from "@/server/modules/auth/session";
import { isPhoneOtpEnabled } from "@/server/modules/notifications/sms-service";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = firstValues(await searchParams);
  const user = await getCurrentUser();
  if (user) redirect(safeRedirectPath(sp.next, user.role === "ADMIN" ? "/admin" : "/account"));
  return (
    <AuthCard
      title="Welcome back"
      description={
        sp.reset
          ? "Your password was updated. Sign in with your new password."
          : "Sign in with your mobile number or email to track orders and check out faster."
      }
      footer={
        <>
          New to Shayvera?{" "}
          <Link
            href={`/register${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <SignInMethods
        phoneEnabled={isPhoneOtpEnabled()}
        // Staff (admin links) and password-reset returns sign in with email + password.
        defaultMethod={sp.reset || sp.next?.startsWith("/admin") ? "email" : "phone"}
        next={sp.next}
        emailForm={<LoginForm next={sp.next} />}
      />
    </AuthCard>
  );
}
