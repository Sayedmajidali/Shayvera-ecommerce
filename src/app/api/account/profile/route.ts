import { ok, parseJson, route } from "@/lib/api";
import { profileUpdateSchema } from "@/lib/validation/account";
import { requireUser } from "@/server/modules/auth/session";
import { updateProfile } from "@/server/modules/customers/account";
import { enforceRateLimit } from "@/server/platform/rate-limit";

export const GET = route(async (req) => ok(await requireUser(req)), { csrf: false });

export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  await enforceRateLimit(`profile:user:${user.id}`, 20, 3600);
  const input = await parseJson(req, profileUpdateSchema);
  return ok(await updateProfile(user.id, input));
});
