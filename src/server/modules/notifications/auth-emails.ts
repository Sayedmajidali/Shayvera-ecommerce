import { escapeHtml, type EmailMessage } from "@/server/modules/notifications/email-service";
import { brandedEmail, EMAIL_COLORS } from "@/server/modules/notifications/email-layout";

export type AuthCodePurpose = "email-verification" | "forget-password";

export const AUTH_CODE_MINUTES = 10;

const COPY: Record<AuthCodePurpose, { subject: string; headline: string; intro: string }> = {
  "email-verification": {
    subject: "Your Shayvera verification code",
    headline: "Verify your email",
    intro: "Enter this code on Shayvera to finish creating your account.",
  },
  "forget-password": {
    subject: "Your Shayvera password reset code",
    headline: "Reset your password",
    intro: "Enter this code on Shayvera, then choose a new password.",
  },
};

/** One-time code email (account verification or password reset), in the store's branded layout. */
export async function renderAuthCodeEmail(
  to: string,
  code: string,
  purpose: AuthCodePurpose,
): Promise<EmailMessage> {
  const c = COPY[purpose];
  const spaced = code.split("").join(" ");
  const warning =
    "Never share this code with anyone — Shayvera will never ask you for it. If you didn’t request it, you can ignore this email.";
  const text = [
    c.intro,
    "",
    `Your code: ${code}`,
    `It expires in ${AUTH_CODE_MINUTES} minutes.`,
    "",
    warning,
  ].join("\n");
  const bodyHtml = `
<h1 style="margin:8px 0 10px;font-size:24px;line-height:1.25;font-weight:700;color:${EMAIL_COLORS.ink}">${escapeHtml(c.headline)}</h1>
<p style="margin:0">${escapeHtml(c.intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0">
<tr><td align="center" style="background:${EMAIL_COLORS.leafSoft};border-radius:14px;padding:20px 12px">
<div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:6px;color:${EMAIL_COLORS.green}" aria-label="Your code is ${escapeHtml(spaced)}">${escapeHtml(code)}</div>
<div style="margin-top:8px;font-size:13px;color:${EMAIL_COLORS.muted}">Expires in ${AUTH_CODE_MINUTES} minutes</div>
</td></tr></table>
<p style="margin:0;font-size:13px;color:${EMAIL_COLORS.muted}">${escapeHtml(warning)}</p>`;
  const branded = await brandedEmail({
    text,
    bodyHtml,
    preheader: `${code} is your Shayvera code. It expires in ${AUTH_CODE_MINUTES} minutes.`,
    footerNote: "You are receiving this email because this address was used on shayvera.in.",
  });
  return { to, subject: c.subject, template: `auth-${purpose}`, ...branded };
}

/** Sent when someone signs up with an email that already has an account (sign-up says nothing). */
export async function renderAccountExistsEmail(to: string, siteUrl: string): Promise<EmailMessage> {
  const site = siteUrl.replace(/\/$/, "");
  const text = [
    "Someone (hopefully you) tried to create a Shayvera account with this email address, but you already have one.",
    "",
    `Sign in: ${site}/login`,
    `Forgot your password? Get a reset code: ${site}/forgot-password`,
    "",
    "If this wasn’t you, you can ignore this email — your account has not been changed.",
  ].join("\n");
  const bodyHtml = `
<h1 style="margin:8px 0 10px;font-size:24px;line-height:1.25;font-weight:700;color:${EMAIL_COLORS.ink}">You already have an account</h1>
<p style="margin:0">Someone (hopefully you) tried to create a Shayvera account with this email address, but an account already exists.</p>
<p style="margin:16px 0 0"><a href="${escapeHtml(site)}/login" style="color:${EMAIL_COLORS.green};font-weight:600">Sign in</a> · <a href="${escapeHtml(site)}/forgot-password" style="color:${EMAIL_COLORS.green};font-weight:600">Forgot password? Get a reset code</a></p>
<p style="margin:20px 0 0;font-size:13px;color:${EMAIL_COLORS.muted}">If this wasn’t you, you can ignore this email — your account has not been changed.</p>`;
  const branded = await brandedEmail({
    text,
    bodyHtml,
    preheader: "Someone tried to create an account with your email.",
    footerNote: "You are receiving this email because this address was used on shayvera.in.",
  });
  return {
    to,
    subject: "You already have a Shayvera account",
    template: "auth-account-exists",
    ...branded,
  };
}
