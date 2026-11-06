import { ok, parseJson } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { inviteStaff, inviteStaffSchema, listStaff } from "@/server/modules/auth/staff";
import { enforceRateLimit } from "@/server/platform/rate-limit";

export const GET = adminRoute("ADMINS_MANAGE", async () => ok(await listStaff()), {
  csrf: false,
});

export const POST = adminRoute("ADMINS_MANAGE", async (req, _ctx, { actor }) => {
  await enforceRateLimit(`staff-invite:${actor.id}`, 20, 3600);
  const input = await parseJson(req, inviteStaffSchema);
  return ok(await inviteStaff(input, actor), 201);
});
