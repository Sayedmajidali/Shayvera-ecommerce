import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm, ProfileForm } from "@/components/store/profile-form";
import { SignInPhone } from "@/components/store/sign-in-phone-card";
import { requireUserPage } from "@/server/modules/auth/session";
import { isPhoneOtpEnabled } from "@/server/modules/notifications/sms-service";
import { db } from "@/server/platform/db";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

export default async function AccountPage() {
  const user = await requireUserPage("/account");
  const hasPassword =
    (await db.account.count({ where: { userId: user.id, providerId: "credential" } })) > 0;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your name and mobile number are used for deliveries.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            name={user.name === user.phoneNumber ? "" : user.name}
            email={user.hasPlaceholderEmail ? null : user.email}
            phone={user.phone}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sign-in mobile number</CardTitle>
          <CardDescription>Sign in with a one-time code sent to this number.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInPhone phoneNumber={user.phoneNumber} phoneEnabled={isPhoneOtpEnabled()} />
        </CardContent>
      </Card>
      {hasPassword && (
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              Changing your password signs you out on other devices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
