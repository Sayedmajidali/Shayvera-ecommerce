import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/store/auth-card";
import { RegisterForm } from "@/components/store/auth-forms";
import { firstValues } from "@/lib/search-params";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const sp = firstValues(await searchParams);
  if (await getCurrentUser()) redirect("/account");
  return (
    <AuthCard
      title="Create your account"
      description="Save addresses, track orders and get members-only offers."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={`/login${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={sp.next} />
    </AuthCard>
  );
}
