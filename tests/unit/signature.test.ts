import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/server/modules/payments/signature";

const secret = "s3cr3t";
const sign = (data: string) => createHmac("sha256", secret).update(data).digest("hex");

describe("Razorpay signatures", () => {
  it("verifies checkout signatures over order_id|payment_id", () => {
    const signature = sign("order_ABC|pay_XYZ");
    expect(
      verifyCheckoutSignature({ orderId: "order_ABC", paymentId: "pay_XYZ", signature, secret }),
    ).toBe(true);
    expect(
      verifyCheckoutSignature({ orderId: "order_ABC", paymentId: "pay_OTHER", signature, secret }),
    ).toBe(false);
    expect(
      verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature,
        secret: "wrong",
      }),
    ).toBe(false);
    expect(
      verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature: "zz-not-hex",
        secret,
      }),
    ).toBe(false);
    expect(
      verifyCheckoutSignature({
        orderId: "order_ABC",
        paymentId: "pay_XYZ",
        signature,
        secret: "",
      }),
    ).toBe(false);
  });

  it("verifies webhook signatures over the exact raw body", () => {
    const body = '{"event":"payment.captured","payload":{}}';
    const signature = sign(body);
    expect(verifyWebhookSignature({ rawBody: body, signature, secret })).toBe(true);
    // Re-serialised JSON (whitespace change) must fail — signature covers raw bytes.
    expect(
      verifyWebhookSignature({
        rawBody: JSON.stringify(JSON.parse(body), null, 1),
        signature,
        secret,
      }),
    ).toBe(false);
    expect(verifyWebhookSignature({ rawBody: body, signature: null, secret })).toBe(false);
    expect(
      verifyWebhookSignature({ rawBody: body, signature: signature.slice(0, -2), secret }),
    ).toBe(false);
  });
});
