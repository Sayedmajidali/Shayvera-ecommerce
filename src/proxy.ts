import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic redirects only: checks for the presence of a session cookie so signed-out
 * visitors are sent to /login quickly. Real authorization (validity, role, ownership)
 * is enforced in layouts, route handlers and services.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(getSessionCookie(request));
  const { pathname, search } = request.nextUrl;

  if (!hasSession && (pathname.startsWith("/account") || pathname.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (hasSession && (pathname === "/login" || pathname === "/register")) {
    // Let the page itself decide (session may be expired); just pass through.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*", "/login", "/register"],
};
