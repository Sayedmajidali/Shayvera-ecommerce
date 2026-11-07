import { randomBytes } from "node:crypto";
import Razorpay from "razorpay";
import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/server/platform/logger";
import { hmacSha256Hex } from "./signature";

export type GatewayOrder = { id: string; amount: number; currency: string; status: string };
export type GatewayPayment = {
  id: string;
  orderId: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  amount: number;
  currency: string;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};
export type GatewayRefund = {
  id: string;
  amount: number;
  status: "pending" | "processed" | "failed";
  /** Our notes, echoed back (we send `refundId`). */
  notes?: Record<string, string>;
};

/**
 * A gateway call failed. `definitive` = the provider answered and refused (4xx other than 408/429):
 * nothing happened and the action may be retried or corrected. Otherwise (timeout, network, 5xx,
 * rate limit) the outcome is unknown and must be reconciled before any retry of a non-idempotent call.
 */
export class GatewayError extends AppError {
  constructor(
    message: string,
    readonly definitive: boolean,
    readonly providerCode: string | null = null,
  ) {
    super("PAYMENT_ERROR", message);
  }
}

export interface PaymentGateway {
  readonly name: "razorpay" | "mock";
  readonly keyId: string;
  createOrder(p: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  refund(p: {
    paymentId: string;
    amountPaise: number;
    notes: Record<string, string>;
  }): Promise<GatewayRefund>;
  /** All refunds of a payment (used to reconcile refunds whose creation outcome was unknown). */
  fetchRefunds(paymentId: string): Promise<GatewayRefund[]>;
}

type RzpPayment = {
  id: string;
  order_id: string;
  status: GatewayPayment["status"];
  amount: number | string;
  currency: string;
  method?: string;
  error_code?: string | null;
  error_description?: string | null;
};

function mapPayment(p: RzpPayment): GatewayPayment {
  return {
    id: p.id,
    orderId: p.order_id,
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    method: p.method ?? null,
    errorCode: p.error_code ?? null,
    errorDescription: p.error_description ?? null,
  };
}

class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay" as const;
  private instance: Razorpay | null = null;
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  private async client(): Promise<Razorpay> {
    this.instance ??= new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    return this.instance;
  }

  private async call<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const e = error as { statusCode?: number; error?: { code?: string; description?: string } };
      logger.error("Razorpay API call failed", {
        label,
        statusCode: e.statusCode,
        code: e.error?.code,
        description: e.error?.description,
      });
      const s = e.statusCode ?? 0;
      const definitive = s >= 400 && s < 500 && s !== 408 && s !== 429;
      throw new GatewayError(
        definitive && e.error?.description
          ? `Razorpay: ${e.error.description}`
          : "The payment provider is unavailable. Please try again.",
        definitive,
        e.error?.code ?? null,
      );
    }
  }

  async createOrder(p: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    const rzp = await this.client();
    const o = (await this.call("orders.create", () =>
      rzp.orders.create({
        amount: p.amountPaise,
        currency: "INR",
        receipt: p.receipt,
        notes: p.notes,
      }),
    )) as { id: string; amount: number | string; currency: string; status: string };
    return { id: o.id, amount: Number(o.amount), currency: o.currency, status: o.status };
  }

  async fetchPayment(paymentId: string) {
    const rzp = await this.client();
    return mapPayment(
      (await this.call("payments.fetch", () =>
        rzp.payments.fetch(paymentId),
      )) as unknown as RzpPayment,
    );
  }

  async fetchOrderPayments(orderId: string) {
    const rzp = await this.client();
    const res = (await this.call("orders.fetchPayments", () =>
      rzp.orders.fetchPayments(orderId),
    )) as unknown as { items: RzpPayment[] };
    return res.items.map(mapPayment);
  }

  async refund(p: { paymentId: string; amountPaise: number; notes: Record<string, string> }) {
    const rzp = await this.client();
    const r = (await this.call("payments.refund", () =>
      rzp.payments.refund(p.paymentId, { amount: p.amountPaise, speed: "normal", notes: p.notes }),
    )) as unknown as RzpRefund;
    return mapRefund(r);
  }

  async fetchRefunds(paymentId: string) {
    const rzp = await this.client();
    const res = (await this.call("payments.fetchMultipleRefund", () =>
      rzp.payments.fetchMultipleRefund(paymentId, { count: 100 }),
    )) as unknown as { items: RzpRefund[] };
    return res.items.map(mapRefund);
  }
}

type RzpRefund = {
  id: string;
  amount: number | string;
  status: GatewayRefund["status"];
  notes?: Record<string, string> | unknown[];
};

function mapRefund(r: RzpRefund): GatewayRefund {
  return {
    id: r.id,
    amount: Number(r.amount),
    status: r.status,
    // Razorpay returns notes as [] when empty.
    notes: Array.isArray(r.notes) ? {} : (r.notes ?? {}),
  };
}

/**
 * Offline simulator for local development and automated tests (never allowed in production by env validation).
 * Mock payment ids encode the outcome: pay_mock_<captured|failed>_<rzpOrderSuffix>_<random>.
 */
export class MockGateway implements PaymentGateway {
  readonly name = "mock" as const;
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  async createOrder(p: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    return {
      id: `order_mock${randomBytes(8).toString("hex")}`,
      amount: p.amountPaise,
      currency: "INR",
      status: "created",
    };
  }

  /** Simulates the Checkout.js handler response, signed exactly as Razorpay would sign it. */
  simulateCheckout(orderId: string, outcome: "captured" | "failed") {
    const paymentId = `pay_mock_${outcome}_${orderId.replace(/^order_mock/, "")}_${randomBytes(4).toString("hex")}`;
    return {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: hmacSha256Hex(`${orderId}|${paymentId}`, this.keySecret),
    };
  }

  private async amountFor(orderId: string) {
    const payment = await db.payment.findUnique({ where: { razorpayOrderId: orderId } });
    return payment?.amountPaise ?? 0;
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    const m = paymentId.match(/^pay_mock_(captured|failed)_([0-9a-f]+)_/);
    if (!m) throw new AppError("PAYMENT_ERROR", "Unknown payment");
    const orderId = `order_mock${m[2]}`;
    const failed = m[1] === "failed";
    return {
      id: paymentId,
      orderId,
      status: failed ? "failed" : "captured",
      amount: await this.amountFor(orderId),
      currency: "INR",
      method: "upi",
      errorCode: failed ? "BAD_REQUEST_ERROR" : null,
      errorDescription: failed ? "Payment was declined by the bank (simulated)" : null,
    };
  }

  async fetchOrderPayments(orderId: string) {
    const payments = await db.payment.findMany({
      where: { razorpayOrderId: orderId, razorpayPaymentId: { not: null } },
    });
    return Promise.all(payments.map((p) => this.fetchPayment(p.razorpayPaymentId!)));
  }

  /** Refunds issued by this simulator, per payment (in-memory, like Razorpay's own list). */
  private refunds = new Map<string, GatewayRefund[]>();

  async refund(p: { paymentId: string; amountPaise: number; notes?: Record<string, string> }) {
    const r: GatewayRefund = {
      id: `rfnd_mock${randomBytes(8).toString("hex")}`,
      amount: p.amountPaise,
      status: "processed",
      notes: p.notes ?? {},
    };
    this.refunds.set(p.paymentId, [...(this.refunds.get(p.paymentId) ?? []), r]);
    return r;
  }

  async fetchRefunds(paymentId: string) {
    return this.refunds.get(paymentId) ?? [];
  }
}

let instance: PaymentGateway | null = null;

export function paymentGateway(): PaymentGateway {
  if (instance) return instance;
  const mode = process.env.PAYMENT_GATEWAY ?? "razorpay";
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (mode === "mock") {
    if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") {
      throw new Error("Mock payment gateway is not allowed in production");
    }
    instance = new MockGateway(keyId || "rzp_test_mock", keySecret || "mock_secret");
    return instance;
  }
  if (!keyId || !keySecret)
    throw new AppError("PAYMENT_ERROR", "Online payments are not configured");
  instance = new RazorpayGateway(keyId, keySecret);
  return instance;
}

export function isOnlinePaymentConfigured(): boolean {
  if (process.env.PAYMENT_GATEWAY === "mock") return true;
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** Test hook: reset the cached gateway after changing env. */
export function resetPaymentGateway() {
  instance = null;
}

/** Test hook: install a specific gateway (e.g. one that simulates timeouts). */
export function setPaymentGateway(g: PaymentGateway | null) {
  instance = g;
}
