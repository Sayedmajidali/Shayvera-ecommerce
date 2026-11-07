import { describe, expect, it, vi } from "vitest";
import { backoffMs } from "@/server/platform/jobs/queue";
import { MemoryCache, cached } from "@/server/platform/cache";
import { HttpError, httpJson } from "@/server/platform/http";
import { redact } from "@/server/platform/logger";
import { currentContext, resolveRequestId, runWithContext } from "@/server/platform/context";

describe("backoffMs", () => {
  it("grows exponentially, is capped, and never drops below 1 s", () => {
    expect(backoffMs(1, () => 0)).toBe(1000);
    expect(backoffMs(1, () => 0.999)).toBeLessThanOrEqual(5000);
    expect(backoffMs(4, () => 0.999)).toBeGreaterThan(backoffMs(2, () => 0.999));
    expect(backoffMs(40, () => 0.999)).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
  });
});

describe("MemoryCache", () => {
  it("expires entries and evicts the oldest when full", async () => {
    vi.useFakeTimers();
    const c = new MemoryCache(2);
    await c.set("a", 1, 1000);
    expect(await c.get("a")).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await c.get("a")).toBeUndefined();
    await c.set("x", 1, 10_000);
    await c.set("y", 2, 10_000);
    await c.set("z", 3, 10_000);
    expect(await c.get("x")).toBeUndefined();
    expect(await c.get("z")).toBe(3);
    vi.useRealTimers();
  });

  it("cached() does not store failures", async () => {
    const compute = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(42);
    await expect(cached("k-fail", 1000, compute)).rejects.toThrow("down");
    expect(await cached("k-fail", 1000, compute)).toBe(42);
    expect(await cached("k-fail", 1000, compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("httpJson", () => {
  const base = { url: "https://provider.test/x", provider: "test", operation: "op" };

  it("retries transient failures only for idempotent requests", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    expect(await httpJson({ ...base, idempotent: true }, f)).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);

    const g = vi.fn().mockResolvedValue(json(503, {}));
    await expect(httpJson({ ...base, method: "POST", json: {} }, g)).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("does not retry client errors and exposes status/body", async () => {
    const f = vi.fn().mockResolvedValue(json(422, { message: "invalid pincode" }));
    const err = (await httpJson({ ...base, idempotent: true }, f).catch((e) => e)) as HttpError;
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ message: "invalid pincode" });
    expect(err.retryable).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("times out slow providers", async () => {
    const slow: typeof fetch = (_u, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      );
    const err = (await httpJson({ ...base, timeoutMs: 50 }, slow).catch((e) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.message).toMatch(/timed out/);
    expect(err.retryable).toBe(true);
  });

  it("tolerates non-JSON bodies", async () => {
    const f = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const err = (await httpJson(base, f).catch((e) => e)) as HttpError;
    expect(err.body).toBe("<html>bad gateway</html>");
  });

  it("propagates the correlation id", async () => {
    const f = vi.fn().mockResolvedValue(json(200, {}));
    await runWithContext({ requestId: "req-12345678" }, () => httpJson(base, f));
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      "X-Request-Id": "req-12345678",
    });
  });
});

describe("logger redaction", () => {
  it("removes secrets and masks personal data", () => {
    const out = redact({
      password: "hunter2",
      razorpaySignature: "abc",
      headers: { authorization: "Bearer t", "x-api-key": "k" },
      email: "asha.rao@example.com",
      phone: "9845012345",
      orderNumber: "SHV00000001",
    }) as Record<string, unknown>;
    const s = JSON.stringify(out);
    expect(s).not.toContain("hunter2");
    expect(s).not.toContain("Bearer t");
    expect(s).not.toContain("asha.rao@");
    expect(s).not.toContain("9845012345");
    expect(s).toContain("2345");
    expect(out.orderNumber).toBe("SHV00000001");
  });
});

describe("request context", () => {
  it("accepts safe incoming ids and replaces unsafe ones", () => {
    expect(resolveRequestId("abc-12345678")).toBe("abc-12345678");
    expect(resolveRequestId("bad id\nwith newline")).not.toContain("\n");
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("isolates context per async flow", async () => {
    const ids = await Promise.all(
      ["req-aaaaaaaa", "req-bbbbbbbb"].map((id) =>
        runWithContext({ requestId: id }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return currentContext()?.requestId;
        }),
      ),
    );
    expect(ids).toEqual(["req-aaaaaaaa", "req-bbbbbbbb"]);
    expect(currentContext()).toBeUndefined();
  });
});

describe("withTimeout", () => {
  it("passes results through and rejects slow work with TimeoutError", async () => {
    const { withTimeout, TimeoutError } = await import("@/server/platform/timeout");
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
    const slow = new Promise((r) => setTimeout(() => r("late"), 200));
    await expect(withTimeout(slow, 20, "Razorpay refund")).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("webhook error reporter", () => {
  it("sends redacted events, caps the rate and never throws", async () => {
    const { createWebhookReporter } = await import("@/server/platform/monitoring");
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      throw new Error("network down"); // a failing monitor must not surface
    }) as unknown as typeof fetch;
    try {
      const report = createWebhookReporter("https://alerts.example/hook", {
        service: "web",
        maxPerMinute: 2,
      });
      expect(() =>
        report(new Error("boom"), {
          orderId: "o1",
          token: "secret-token",
          email: "asha@example.com",
        }),
      ).not.toThrow();
      report(new Error("two"), {});
      report(new Error("three"), {});
      await new Promise((r) => setTimeout(r, 0));
      expect(calls).toHaveLength(2);
      const ctx = calls[0]!.body.context as Record<string, unknown>;
      expect(calls[0]!.body).toMatchObject({
        service: "web",
        level: "error",
        error: { message: "boom" },
      });
      expect(ctx.token).toBe("[redacted]");
      expect(ctx.email).not.toBe("asha@example.com");
      expect(ctx.orderId).toBe("o1");
    } finally {
      globalThis.fetch = original;
    }
  });
});
