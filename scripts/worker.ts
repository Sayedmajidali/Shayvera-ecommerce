/**
 * Background job worker. Run alongside the web server in production:
 *
 *   npm run worker
 *
 * Safe to run several instances: jobs are claimed with FOR UPDATE SKIP LOCKED.
 * SIGINT/SIGTERM finish the current batch before exiting.
 */
import "dotenv/config";
import { db } from "../src/server/platform/db";
import { logger } from "../src/server/platform/logger";
import { startJobLoop } from "../src/server/jobs/loop";
import { setupMonitoring } from "../src/server/platform/monitoring";

setupMonitoring("worker");

const loop = startJobLoop({ label: "worker", pollMs: Number(process.env.WORKER_POLL_MS ?? 2000) });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Worker shutting down", { signal });
  const force = setTimeout(() => process.exit(1), 30_000);
  await loop.stop();
  await db.$disconnect();
  clearTimeout(force);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// Keep the process alive (the loop timers are unref'd).
setInterval(() => {}, 1 << 30);
