import { siteConfig } from "@/lib/site";
import { escapeHtml } from "@/server/modules/notifications/email-service";
import { loadStoreSettings } from "@/server/modules/settings/queries";

/*
 * Branded email layout shared by every store email. Built for email clients, not browsers:
 * tables for layout, inline styles only (Gmail/Outlook ignore <style> blocks in many cases), a PNG logo
 * (SVG and WebP are not shown by Gmail/Outlook), web-safe fonts, a 600px column that shrinks on phones,
 * and a button made of a coloured table cell (renders in Outlook desktop too).
 */

export const EMAIL_COLORS = {
  green: "#0c764e",
  greenDark: "#09583b",
  leafSoft: "#eef4e0",
  saffron: "#cc6824",
  ink: "#1f2a24",
  muted: "#6b7069",
  line: "#e7e1d6",
  page: "#f6f3ec",
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Green call-to-action button (bulletproof: the whole cell is coloured and clickable). */
export function emailButton(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0">
<tr><td align="center" bgcolor="${EMAIL_COLORS.green}" style="border-radius:999px;background:${EMAIL_COLORS.green}">
<a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/** A soft-coloured panel for highlights (delivery estimate, tracking number…). */
export function emailPanel(innerHtml: string, tone: "green" | "neutral" = "green") {
  const bg = tone === "green" ? EMAIL_COLORS.leafSoft : "#faf8f3";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0">
<tr><td style="background:${bg};border-radius:12px;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.ink}">${innerHtml}</td></tr></table>`;
}

/** Small uppercase section label. */
export function emailSectionTitle(title: string) {
  return `<p style="margin:24px 0 8px;font-family:${FONT};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:${EMAIL_COLORS.muted}">${escapeHtml(title)}</p>`;
}

export async function brandedEmail(p: {
  bodyHtml: string;
  text: string;
  footerNote?: string;
  /** Inbox preview line (hidden in the email itself). */
  preheader?: string;
}) {
  const s = await loadStoreSettings();
  const contact = [s.supportEmail, s.supportPhone].filter(Boolean).join(" · ");
  const footer = `${s.storeName}${contact ? ` · ${contact}` : ""}`;
  const note = p.footerNote ?? "You are receiving this email about an order you placed with us.";
  const site = siteConfig.url.replace(/\/$/, "");
  const logo = `${site}/brand/email-logo.png`;
  const host = site.replace(/^https?:\/\//, "");
  const preheader = p.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(p.preheader)}&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;</div>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(s.storeName)}</title></head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.page};-webkit-text-size-adjust:100%">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL_COLORS.page}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;border:1px solid ${EMAIL_COLORS.line};overflow:hidden">
<tr><td style="height:5px;background:${EMAIL_COLORS.green};line-height:5px;font-size:0">&nbsp;</td></tr>
<tr><td align="center" style="padding:22px 24px 14px">
<a href="${escapeHtml(site)}" target="_blank" style="text-decoration:none"><img src="${escapeHtml(logo)}" width="150" height="85" alt="${escapeHtml(s.storeName)}" style="display:block;border:0;width:150px;height:auto;max-width:150px"></a>
</td></tr>
<tr><td style="padding:4px 28px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${EMAIL_COLORS.ink}">${p.bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;background:#faf8f3;border-top:1px solid ${EMAIL_COLORS.line};font-family:${FONT};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted}" align="center">
<strong style="color:${EMAIL_COLORS.ink}">${escapeHtml(s.storeName)}</strong>${contact ? `<br>${escapeHtml(contact)}` : ""}<br>
<a href="${escapeHtml(site)}" target="_blank" style="color:${EMAIL_COLORS.green};text-decoration:none">${escapeHtml(host)}</a><br>
<span>${escapeHtml(note)}</span>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { html, text: `${p.text}\n\n—\n${footer}\n${note}` };
}
