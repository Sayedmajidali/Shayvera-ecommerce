import { z } from "zod";
import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { getCustomer, setCustomerStatus } from "@/server/modules/customers/admin-customers";

type Ctx = RouteCtx<{ id: string }>;

export const GET = adminRoute<Ctx>(
  "CUSTOMERS_VIEW",
  async (_req, { params }) => {
    const { sessions, ...customer } = await getCustomer((await params).id);
    return ok({ ...customer, activeSessions: sessions.length });
  },
  { csrf: false },
);

export const PATCH = adminRoute<Ctx>("CUSTOMERS_MANAGE", async (req, { params }, { actor }) => {
  const { status } = await parseJson(req, z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }));
  await setCustomerStatus((await params).id, status, actor);
  return ok({ status });
});
