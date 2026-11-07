/** Thrown when an operation does not settle in time. The outcome of the operation is unknown. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Settles with the promise, or rejects with TimeoutError after `ms`. The underlying work is not
 * cancelled — callers must treat a timeout as "outcome unknown" (reconcile before any retry).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "Operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
