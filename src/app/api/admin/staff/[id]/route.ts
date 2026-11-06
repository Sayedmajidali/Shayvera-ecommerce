import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { removeStaff, updateStaff, updateStaffSchema } from "@/server/modules/auth/staff";

type Ctx = RouteCtx<{ id: string }>;

export const PATCH = adminRoute<Ctx>("ADMINS_MANAGE", async (req, { params }, { actor }) => {
  const input = await parseJson(req, updateStaffSchema);
  return ok(await updateStaff((await params).id, input, actor));
});

export const DELETE = adminRoute<Ctx>("ADMINS_MANAGE", async (_req, { params }, { actor }) => {
  await removeStaff((await params).id, actor);
  return ok({ removed: true });
});
