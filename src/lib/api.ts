import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/server/platform/logger";

export type ApiSuccess<T> = { data: T };
export type ApiFailure = { error: { code: string; message: string; details?: unknown } };

export function ok<T>(data: T, init?: number | ResponseInit) {
  const resInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json<ApiSuccess<T>>({ data }, resInit);
}

export function fail(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json<ApiFailure>(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Maps any thrown error into a safe JSON response. Internal details are logged, never returned. */
export function toErrorResponse(err: unknown, requestId?: string) {
  if (err instanceof AppError) return fail(err.code, err.message, err.status, err.details);
  if (err instanceof ZodError) {
    return fail("VALIDATION_ERROR", "Some fields are invalid", 400, formatZodError(err));
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002")
      return fail("CONFLICT", "A record with these details already exists", 409);
    if (err.code === "P2025") return fail("NOT_FOUND", "Resource not found", 404);
    if (err.code === "P2003")
      return fail("CONFLICT", "This record is referenced by other data", 409);
  }
  logger.error("Unhandled API error", { requestId, error: err });
  return fail("INTERNAL", "Something went wrong. Please try again.", 500);
}

export function formatZodError(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const DEFAULT_JSON_LIMIT = 64 * 1024;

/** Reads and validates a JSON body with a size cap. */
export async function parseJson<T>(req: Request, schema: ZodType<T>, limit = DEFAULT_JSON_LIMIT) {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > limit) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large");
  const text = await req.text();
  if (text.length > limit) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("VALIDATION_ERROR", "Malformed JSON body");
  }
  return schema.parse(raw);
}

export function parseSearchParams<T>(url: string | URL, schema: ZodType<T>): T {
  const u = typeof url === "string" ? new URL(url) : url;
  return schema.parse(Object.fromEntries(u.searchParams.entries()));
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests: the Origin (or Referer)
 * must match this application's origin. Browsers always send Origin on cross-site POSTs.
 */
export function assertSameOrigin(req: Request) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const expected = new URL(req.url).origin;
  const allowed = new Set([expected, process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL]);
  const origin = req.headers.get("origin");
  if (origin) {
    if (!allowed.has(origin)) throw new AppError("FORBIDDEN", "Cross-origin request rejected");
    return;
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (allowed.has(new URL(referer).origin)) return;
    } catch {
      /* fall through */
    }
  }
  throw new AppError("FORBIDDEN", "Missing request origin");
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler with origin checks and uniform error handling. */
export function route<C = unknown>(handler: Handler<C>, opts: { csrf?: boolean } = {}): Handler<C> {
  const csrf = opts.csrf ?? true;
  return async (req, ctx) => {
    const requestId = crypto.randomUUID();
    try {
      if (csrf) assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      return toErrorResponse(err, requestId);
    }
  };
}

/** Shape of the dynamic route context: `{ params: Promise<{...}> }`. */
export type RouteCtx<P extends Record<string, string>> = { params: Promise<P> };
