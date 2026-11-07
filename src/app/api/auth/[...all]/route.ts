import { toNextJsHandler } from "better-auth/next-js";
import { assertSameOrigin, toErrorResponse } from "@/lib/api";
import { auth } from "@/lib/auth";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

/**
 * Better Auth checks origins only for requests that already carry cookies, which leaves sign-in and
 * sign-up open to login CSRF (an attacker's page signing the visitor into the attacker's account).
 * Every auth POST must therefore come from this site.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch (error) {
    return toErrorResponse(error);
  }
  return handler.POST(req);
}
