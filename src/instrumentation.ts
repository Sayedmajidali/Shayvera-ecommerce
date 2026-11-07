import type { Instrumentation } from "next";

/**
 * Runs once per server start: error reporting (when configured) and, in development, the in-process
 * job runner.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { setupMonitoring } = await import("@/server/platform/monitoring");
  setupMonitoring("web");
  const { jobRunnerMode } = await import("@/lib/env");
  if (jobRunnerMode() !== "inline") return;
  const { startJobLoop } = await import("@/server/jobs/loop");
  startJobLoop({ label: "inline", pollMs: 3_000 });
}

/**
 * Server errors Next.js catches outside our API wrapper (page/Server Component rendering, server
 * actions, proxy). Logged with the route and digest — the digest is what the user's error page shows.
 * Query strings are dropped: guest order links carry access tokens there.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("@/server/platform/monitoring");
  const digest =
    typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  const header = request.headers["x-request-id"];
  captureException(err, {
    message: "Unhandled server error",
    path: request.path.split("?")[0],
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    digest,
    requestId: Array.isArray(header) ? header[0] : header,
  });
};
