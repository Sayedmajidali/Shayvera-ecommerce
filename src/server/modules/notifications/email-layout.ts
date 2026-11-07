import { escapeHtml } from "@/server/modules/notifications/email-service";
import { loadStoreSettings } from "@/server/modules/settings/queries";

/**
 * Wraps an email body in the store's simple branded layout (inline styles only: email clients
 * ignore stylesheets). Footer carries the store's support contact from Settings.
 */
export async function brandedEmail(p: { bodyHtml: string; text: string; footerNote?: string }) {
  const s = await loadStoreSettings();
  const contact = [s.supportEmail, s.supportPhone].filter(Boolean).join(" · ");
  const footer = `${s.storeName}${contact ? ` · ${contact}` : ""}`;
  const note = p.footerNote ?? "You are receiving this email about an order you placed with us.";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Arial,Helvetica,sans-serif;color:#2b2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e8e1d6">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e8e1d6;font-size:20px;font-weight:bold">${escapeHtml(s.storeName)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${p.bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e8e1d6;font-size:12px;color:#7a6f66">${escapeHtml(footer)}<br>${escapeHtml(note)}</td></tr>
</table></td></tr></table></body></html>`;
  return { html, text: `${p.text}\n\n—\n${footer}\n${note}` };
}
