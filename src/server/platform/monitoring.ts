/**
 * Error monitoring hook. Logs every captured exception with context; when an error-tracking service is
 * configured (e.g. SENTRY_DSN) a reporter can be registered at startup without touching call sites.
 * No third-party SDK is bundled yet — see PRODUCTION_READINESS.md.
 */
import { logger, redact } from "@/server/platform/logger";

type Reporter = (error: unknown, context: Record<string, unknown>) => void;
let reporter: Reporter | null = null;

export function registerErrorReporter(r: Reporter) {
  reporter = r;
}

export function captureException(error: unknown, context: Record<string, unknown> = {}) {
  logger.error(context.message ? String(context.message) : "Unhandled exception", {
    ...context,
    error,
  });
  try {
    reporter?.(error, context);
  } catch {
    /* never let monitoring break the request */
  }
}

/** Integration failures (payment/shipping providers) are logged with a stable category for alerting. */
export function captureIntegrationFailure(
  provider: string,
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  logger.error("Integration failure", {
    category: "integration",
    provider,
    operation,
    ...context,
    error,
  });
  try {
    reporter?.(error, { provider, operation, ...context });
  } catch {
    /* ignore */
  }
}

/**
 * Dependency-free reporter: POSTs a redacted JSON event to a webhook (an alerting relay, a chat
 * incoming-webhook, or an error-tracking ingest that accepts JSON). At most `maxPerMinute` events are
 * sent per process; each send times out after 3 s and never throws into the caller.
 */
export function createWebhookReporter(
  url: string,
  opts: { service?: string; environment?: string; maxPerMinute?: number } = {},
): Reporter {
  const max = opts.maxPerMinute ?? 20;
  let windowStart = 0;
  let sent = 0;
  return (error, context) => {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      sent = 0;
    }
    if (sent >= max) return;
    sent++;
    const err =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) };
    const body = JSON.stringify({
      service: opts.service ?? "shayvera",
      environment: opts.environment ?? process.env.NODE_ENV,
      level: "error",
      time: new Date(now).toISOString(),
      error: err,
      context: redact(context),
    });
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      /* monitoring must never affect the request; the log line already exists */
    });
  };
}

/** Registers the configured reporter (web server and worker call this once at start-up). */
export function setupMonitoring(service: string) {
  const url = process.env.MONITORING_WEBHOOK_URL?.trim();
  if (!url) return false;
  registerErrorReporter(createWebhookReporter(url, { service }));
  logger.info("Error reporting enabled", { service, target: new URL(url).host });
  return true;
}
