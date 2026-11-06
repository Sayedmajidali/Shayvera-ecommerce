import { ok, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { generateInvoice } from "@/server/modules/invoices/invoices";

export const POST = adminRoute<RouteCtx<{ id: string }>>(async (_req, { params }, { actor }) => {
  const invoice = await generateInvoice((await params).id, actor);
  return ok({ invoiceNumber: invoice.invoiceNumber }, 201);
});
