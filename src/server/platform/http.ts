import { captureIntegrationFailure } from "@/server/platform/monitoring";
import { currentContext } from "@/server/platform/context";

/**
 * Outbound HTTP for provider integrations (Shiprocket, Razorpay REST, email APIs).
 *
 * - Every request has a timeout (AbortSignal), default from SHIPPING_HTTP_TIMEOUT_MS or 10 s.
 * - Retries happen ONLY when the caller marks the request idempotent (reads, or writes the provider
 *   deduplicates). Non-idempotent creates must not be retried blindly: callers reconcile first
 *   (ARCHITECTURE.md D4).
 * - Retries on network errors, timeouts, 408, 429 and 5xx, with exponential backoff + jitter,
 *   honouring Retry-After when present.
 * - Never logs request bodies or headers (they may carry credentials or personal data).
 */

export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: unknown,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type HttpRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  json?: unknown;
  timeoutMs?: number;
  /** Retry transient failures. Set only for idempotent operations. */
  idempotent?: boolean;
  maxRetries?: number;
  /** For logs/metrics, e.g. "shiprocket". */
  provider: string;
  operation: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  const date = Date.parse(v);
  return Number.isNaN(date) ? null : Math.min(Math.max(0, date - Date.now()), 30_000);
}

export async function httpJson<T = unknown>(
  req: HttpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const timeoutMs = req.timeoutMs ?? (Number(process.env.SHIPPING_HTTP_TIMEOUT_MS) || 10_000);
  const maxRetries = req.idempotent ? (req.maxRetries ?? 2) : 0;
  let lastError: HttpError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let delay: number | null = null;
    try {
      const res = await fetchImpl(req.url, {
        method: req.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(req.json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(currentContext()?.requestId ? { "X-Request-Id": currentContext()!.requestId } : {}),
          ...req.headers,
        },
        body: req.json !== undefined ? JSON.stringify(req.json) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body kept as text */
      }
      if (res.ok) return body as T;
      lastError = new HttpError(
        `${req.provider} ${req.operation} failed with HTTP ${res.status}`,
        res.status,
        body,
        retryableStatus(res.status),
      );
      delay = retryAfterMs(res);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      lastError = new HttpError(
        timedOut
          ? `${req.provider} ${req.operation} timed out after ${timeoutMs} ms`
          : `${req.provider} ${req.operation} network error: ${error instanceof Error ? error.message : String(error)}`,
        null,
        null,
        true,
      );
    }
    if (!lastError.retryable || attempt === maxRetries) break;
    await sleep(delay ?? Math.floor(Math.random() * 300 * 2 ** attempt) + 100);
  }
  captureIntegrationFailure(req.provider, req.operation, lastError, {
    status: lastError?.status ?? null,
  });
  throw lastError;
}
