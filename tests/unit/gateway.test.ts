import { afterEach, describe, expect, it } from "vitest";
import { GatewayError, RazorpayGateway } from "@/server/modules/payments/gateway";

/**
 * The real Razorpay adapter with a fake SDK client (no network). Verifies request mapping and the
 * error classification that decides between "release the amount" (definitive) and "reconcile first"
 * (unknown outcome).
 */
function gateway(fake: unknown) {
  const gw = new RazorpayGateway("rzp_test_unit000000001", "unit_secret");
  (gw as unknown as { instance: unknown }).instance = fake;
  return gw;
}
const rejecting = (statusCode: number | undefined, description?: string) => ({
  payments: {
    refund: () => Promise.reject({ statusCode, error: { code: "BAD_REQUEST_ERROR", description } }),
  },
});

afterEach(() => {
  delete process.env.RAZORPAY_HTTP_TIMEOUT_MS;
});

describe("RazorpayGateway (fake SDK)", () => {
  it("maps orders and refunds, sending amounts in paise and notes through", async () => {
    let sent: Record<string, unknown> = {};
    const gw = gateway({
      orders: {
        create: (body: Record<string, unknown>) => {
          sent = body;
          return Promise.resolve({
            id: "order_1",
            amount: "49900",
            currency: "INR",
            status: "created",
          });
        },
      },
      payments: {
        refund: (_id: string, body: Record<string, unknown>) =>
          Promise.resolve({ id: "rfnd_1", amount: body.amount, status: "processed", notes: [] }),
      },
    });
    expect(
      await gw.createOrder({ amountPaise: 49_900, receipt: "SHV1", notes: { orderId: "o1" } }),
    ).toEqual({
      id: "order_1",
      amount: 49_900,
      currency: "INR",
      status: "created",
    });
    expect(sent).toMatchObject({
      amount: 49_900,
      currency: "INR",
      receipt: "SHV1",
      notes: { orderId: "o1" },
    });
    // Razorpay returns empty notes as []: normalised to {}.
    expect(await gw.refund({ paymentId: "pay_1", amountPaise: 100, notes: {} })).toEqual({
      id: "rfnd_1",
      amount: 100,
      status: "processed",
      notes: {},
    });
  });

  it.each([
    [400, true],
    [404, true],
    [422, true],
    [408, false],
    [429, false],
    [500, false],
    [502, false],
    [undefined, false], // network error: no HTTP status
  ])("HTTP %s → definitive %s", async (status, definitive) => {
    const err = (await gateway(rejecting(status, "The amount is invalid"))
      .refund({ paymentId: "p", amountPaise: 1, notes: {} })
      .catch((e) => e)) as GatewayError;
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.definitive).toBe(definitive);
    // Provider wording is shown only for definite refusals; otherwise a generic message.
    expect(err.message).toBe(
      definitive
        ? "Razorpay: The amount is invalid"
        : "The payment provider is unavailable. Please try again.",
    );
  });

  it("a hung call times out as an unknown outcome", async () => {
    process.env.RAZORPAY_HTTP_TIMEOUT_MS = "1000";
    const gw = gateway({ payments: { refund: () => new Promise(() => {}) } });
    const started = Date.now();
    const err = (await gw
      .refund({ paymentId: "p", amountPaise: 1, notes: {} })
      .catch((e) => e)) as GatewayError;
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.definitive).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
