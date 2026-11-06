/**
 * Error monitoring hook. Logs every captured exception with context; when an error-tracking service is
 * configured (e.g. SENTRY_DSN) a reporter can be registered at startup without touching call sites.
 * No third-party SDK is bundled yet — see PRODUCTION_READINESS.md.
 */
import { logger } from "@/server/platform/logger";

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
