"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PhoneOtpForm } from "@/components/store/phone-otp-form";

/** Mobile OTP (default) and email tabs for the sign-in and register pages. */
export function SignInMethods({
  phoneEnabled,
  next,
  emailForm,
  defaultMethod = "phone",
}: {
  phoneEnabled: boolean;
  defaultMethod?: "phone" | "email";
  next?: string;
  emailForm: React.ReactNode;
}) {
  if (!phoneEnabled) return <>{emailForm}</>;
  return (
    <Tabs defaultValue={defaultMethod} className="gap-5">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="phone">Mobile OTP</TabsTrigger>
        <TabsTrigger value="email">Email &amp; password</TabsTrigger>
      </TabsList>
      <TabsContent value="phone">
        <PhoneOtpForm next={next} />
      </TabsContent>
      <TabsContent value="email">{emailForm}</TabsContent>
    </Tabs>
  );
}
