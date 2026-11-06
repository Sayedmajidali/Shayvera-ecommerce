import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { AdminPageHeader } from "@/components/admin/page-header";
import { db } from "@/server/platform/db";
import { requireAdminPage } from "@/server/modules/auth/session";

export const metadata: Metadata = { title: "Email outbox" };

/** Development email sink: shows messages that a production email provider would send. */
export default async function EmailsPage() {
  // Each page authorizes itself: layouts are not re-rendered on client-side navigation.
  await requireAdminPage();
  const [emails, messages] = await Promise.all([
    db.outboundEmail.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return (
    <>
      <AdminPageHeader
        title="Contact messages"
        description="Messages submitted through the storefront contact form."
      />
      <Card className="mb-10 gap-0 divide-y py-0">
        {messages.length === 0 && (
          <p className="text-muted-foreground p-6 text-sm">No messages yet.</p>
        )}
        {messages.map((m) => (
          <details key={m.id} className="p-4">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{m.subject}</span>
              <span className="text-muted-foreground">
                from {m.name} &lt;{m.email}&gt;{m.phone ? ` · ${m.phone}` : ""}
              </span>
              <span className="text-muted-foreground ml-auto text-xs">
                {m.createdAt.toLocaleString("en-IN")}
              </span>
            </summary>
            <p className="bg-muted mt-3 rounded-lg p-4 text-sm whitespace-pre-wrap">{m.message}</p>
          </details>
        ))}
      </Card>
      <AdminPageHeader
        title="Email outbox"
        description="Local development: transactional emails are stored here instead of being sent. Connect an email provider before launch."
      />
      <Card className="gap-0 divide-y py-0">
        {emails.length === 0 && <p className="text-muted-foreground p-6 text-sm">No emails yet.</p>}
        {emails.map((e) => (
          <details key={e.id} className="p-4">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{e.subject}</span>
              <span className="text-muted-foreground">to {e.to}</span>
              <span className="text-muted-foreground font-mono text-xs">{e.template}</span>
              <span className="text-muted-foreground ml-auto text-xs">
                {e.createdAt.toLocaleString("en-IN")}
              </span>
            </summary>
            <pre className="bg-muted mt-3 overflow-x-auto rounded-lg p-4 text-xs whitespace-pre-wrap">
              {e.text}
            </pre>
          </details>
        ))}
      </Card>
    </>
  );
}
