import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { deleteRole, roleUpdateSchema, updateRole } from "@/server/modules/auth/staff";

type Ctx = RouteCtx<{ id: string }>;

export const PATCH = adminRoute<Ctx>("ADMINS_MANAGE", async (req, { params }, { actor }) =>
  ok(await updateRole((await params).id, await parseJson(req, roleUpdateSchema), actor)),
);

export const DELETE = adminRoute<Ctx>("ADMINS_MANAGE", async (_req, { params }, { actor }) => {
  await deleteRole((await params).id, actor);
  return ok({ deleted: true });
});
