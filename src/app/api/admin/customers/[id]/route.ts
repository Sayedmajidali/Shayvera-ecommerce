import { z } from "zod";
import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { getCustomer, setCustomerStatus } from "@/server/services/admin-misc";

type Ctx = RouteCtx<{ id: string }>;

export const GET = adminRoute<Ctx>(
  async (_req, { params }) => {
    const { sessions, ...customer } = await getCustomer((await params).id);
    return ok({ ...customer, activeSessions: sessions.length });
  },
  { csrf: false },
);

export const PATCH = adminRoute<Ctx>(async (req, { params }, { actor }) => {
  const { status } = await parseJson(req, z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }));
  await setCustomerStatus((await params).id, status, actor);
  return ok({ status });
});
