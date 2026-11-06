import { ok, parseJson } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { createRole, listRoles, roleSchema } from "@/server/modules/auth/staff";

export const GET = adminRoute("ADMINS_MANAGE", async () => ok(await listRoles()), {
  csrf: false,
});

export const POST = adminRoute("ADMINS_MANAGE", async (req, _ctx, { actor }) =>
  ok(await createRole(await parseJson(req, roleSchema), actor), 201),
);
