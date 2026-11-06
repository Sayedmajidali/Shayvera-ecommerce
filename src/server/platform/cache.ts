/**
 * Small cache abstraction (ARCHITECTURE.md D9). Only public, non-personal data is cached
 * (serviceability quotes, catalog lookups); never carts, orders, sessions or prices at checkout.
 *
 * The default implementation is an in-process TTL map, which is correct for a single instance.
 * With several instances each keeps its own copy; values must therefore be safe to be briefly
 * stale. A shared implementation (e.g. Redis) can implement `Cache` if ever needed.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  constructor(private readonly maxEntries = 5_000) {}

  async get<T>(key: string) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number) {
    if (this.store.size >= this.maxEntries) {
      // Evict the oldest insertion (Map preserves insertion order).
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

const g = globalThis as unknown as { __appCache?: Cache };
export const cache: Cache = (g.__appCache ??= new MemoryCache());

/** Returns the cached value or computes, stores and returns it. Errors are not cached. */
export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await compute();
  await cache.set(key, value, ttlMs);
  return value;
}
