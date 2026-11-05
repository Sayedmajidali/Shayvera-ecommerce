import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { AdminPageHeader } from "@/components/admin/page-header";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Email outbox" };

/** Development email sink: shows messages that a production email provider would send. */
export default async function EmailsPage() {
  const emails = await db.outboundEmail.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <>
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
