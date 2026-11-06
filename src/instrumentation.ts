/** Runs once per server start. Starts the in-process job runner when configured (development). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { jobRunnerMode } = await import("@/lib/env");
  if (jobRunnerMode() !== "inline") return;
  const { startJobLoop } = await import("@/server/jobs/loop");
  startJobLoop({ label: "inline", pollMs: 3_000 });
}
