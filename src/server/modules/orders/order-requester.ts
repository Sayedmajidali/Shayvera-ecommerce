import "server-only";
import { getUserFromHeaders } from "@/server/modules/auth/session";

/** Who is asking for an order: signed-in user and/or a guest access token (?t= or body). */
export async function orderRequester(req: Request, bodyToken?: string | null) {
  const user = await getUserFromHeaders(req.headers);
  const token = bodyToken ?? new URL(req.url).searchParams.get("t");
  return { userId: user?.id ?? null, token: token && token.length <= 64 ? token : null };
}
