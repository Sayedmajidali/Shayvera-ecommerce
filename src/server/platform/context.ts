import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Per-request / per-job execution context, propagated automatically through async calls.
 * Every log line, enqueued job and outbound provider call picks up the correlation id from here.
 */
export type ExecutionContext = {
  requestId: string;
  jobId?: string;
  jobType?: string;
  actorId?: string | null;
};

const storage = new AsyncLocalStorage<ExecutionContext>();

export function currentContext(): ExecutionContext | undefined {
  return storage.getStore();
}

export function runWithContext<T>(ctx: ExecutionContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

const VALID_ID = /^[A-Za-z0-9._:-]{8,100}$/;

/** Accepts an upstream id (load balancer / client) when well-formed, otherwise generates one. */
export function resolveRequestId(incoming: string | null | undefined): string {
  return incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
}
