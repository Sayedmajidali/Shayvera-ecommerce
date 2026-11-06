import { ok, parseJson, route } from "@/lib/api";
import { addressInputSchema } from "@/lib/validation/account";
import { requireUser } from "@/server/modules/auth/session";
import { deleteAddress, updateAddress } from "@/server/modules/customers/account";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const input = await parseJson(req, addressInputSchema);
  return ok(await updateAddress(user.id, id, input));
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await deleteAddress(user.id, id);
  return ok({ deleted: true });
});
