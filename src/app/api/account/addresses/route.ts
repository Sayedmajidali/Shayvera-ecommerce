import { ok, parseJson, route } from "@/lib/api";
import { addressInputSchema } from "@/lib/validation/account";
import { requireUser } from "@/server/modules/auth/session";
import { createAddress, listAddresses } from "@/server/modules/customers/account";
import { enforceRateLimit } from "@/server/platform/rate-limit";

export const GET = route(
  async (req) => {
    const user = await requireUser(req);
    return ok(await listAddresses(user.id));
  },
  { csrf: false },
);

export const POST = route(async (req) => {
  const user = await requireUser(req);
  await enforceRateLimit(`address:user:${user.id}`, 30, 3600);
  const input = await parseJson(req, addressInputSchema);
  return ok(await createAddress(user.id, input), 201);
});
