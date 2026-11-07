# Payment Integration — Razorpay

Sources: Razorpay docs read 2026-11-06 — _Webhooks: Validate and Test_, _Webhooks: Best Practices_ — and the
official `razorpay` Node SDK 2.9.x. Module: `src/server/modules/payments`.

## 1. Components

| Piece                      | Location                                             | Responsibility                                                                                       |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PaymentGateway` interface | `payments/gateways/types.ts`                         | createOrder, fetchPayment, fetchOrderPayments, refund, fetchRefunds                                  |
| `RazorpayGateway`          | `payments/gateways/razorpay.ts`                      | official SDK, server-side key secret, timeouts, error mapping                                        |
| `MockGateway`              | `payments/gateways/mock.ts`                          | offline simulator signing exactly like Razorpay; refused in production                               |
| Signatures                 | `payments/signature.ts`                              | checkout HMAC(order_id\|payment_id, key secret); webhook HMAC(raw body, webhook secret); timing-safe |
| Orchestration              | `payments/service.ts`                                | start/resume payment, verify callback, apply capture/failure, reconcile, expire                      |
| Webhooks                   | `payments/webhooks.ts` + `app/api/webhooks/razorpay` | verify → store → apply → enqueue follow-ups → 2xx                                                    |
| Refunds                    | `payments/refunds.ts`                                | reservation-first refunds, gateway call, settlement, reconciliation                                  |

## 2. Payment workflow

1. Checkout validates cart, prices, stock, address and eligibility **on the server**; creates the order
   (`PENDING`), reserves stock (expires after `PAYMENT_EXPIRY_MINUTES`), all in one transaction.
2. After commit, the server creates a Razorpay Order (amount in paise, `receipt` = order number,
   `notes.orderId`) and a `Payment` row (`CREATED`, unique `razorpayOrderId`). If the API is down the order
   stays `PENDING` and the customer can retry ("Complete payment"), which reuses or recreates the gateway order.
3. The browser opens Checkout.js with the public key id only.
4. On success the browser posts `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` to
   `/api/payments/razorpay/verify`. The server verifies the HMAC, **fetches the payment from Razorpay**, and
   requires `status = captured`, matching order id, amount and currency. Only then: payment `CAPTURED`, order
   `PAID` + `CONFIRMED`, reservation kept for fulfilment.
5. Independently, Razorpay sends `payment.captured` / `order.paid` webhooks; whichever arrives first wins, the
   other is a no-op (row lock on the payment + status checks).
6. Follow-ups (confirmation email, late-capture refunds) are enqueued as jobs — never done inline in a webhook.

## 3. Webhooks

- Endpoint: `POST /api/webhooks/razorpay`; body read as **raw text** before parsing.
- Authenticity: `X-Razorpay-Signature` = HMAC-SHA256(raw body, `RAZORPAY_WEBHOOK_SECRET`). During secret
  rotation `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` is also accepted (Razorpay signs retries of older events with the
  old secret).
- Deduplication: `x-razorpay-event-id` stored in `PaymentEvent.eventId` (unique). Razorpay delivers
  _at least once_ and retries non-2xx responses with exponential backoff for 24 h; a duplicate returns 200
  without reprocessing; an event that previously failed mid-processing is retried.
- Speed: Razorpay treats > 5 s as a timeout and resends. **Implemented (Phase 8):** the endpoint only verifies the
  signature, stores the event and enqueues a `payments.webhook` job in the same transaction, then answers 200.
  The job applies the event (idempotent: `processedAt` + payment row lock); failures retry with backoff, and a dead
  job is revived when Razorpay redelivers the event or when staff press "Retry" in Admin → Payments.
- Ordering: events may arrive out of order (`payment.captured` before `payment.authorized`, `payment.failed`
  for an earlier attempt after a capture). State only moves forward; a captured payment is never downgraded.
- Handled events: `payment.authorized` (recorded), `payment.captured`, `order.paid`, `payment.failed`,
  `refund.processed`, `refund.failed`. Others are stored and acknowledged.

## 4. Failure scenarios

| Scenario                                  | Behaviour                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Customer closes Checkout                  | order stays `PENDING`; "Complete payment" on order page; expires and releases stock after the window       |
| Payment fails                             | attempt `FAILED`, order `PAYMENT_FAILED`; retry creates a new attempt; stock still reserved until expiry   |
| Callback lost (tab closed)                | webhook or reconciliation (`fetchOrderPayments`) confirms the order                                        |
| Webhook delayed until after expiry        | stock re-reserved if available and order reinstated; otherwise full refund queued and order flagged        |
| Duplicate payment (two attempts captured) | second payment refunded automatically outside the order's refundable total                                 |
| Amount/currency mismatch                  | not confirmed; order flagged "needs attention"                                                             |
| Razorpay API down                         | checkout returns the order with "retry payment"; reconciliation job retries; dashboards show pending items |

## 5. Refunds

1. Reserve the amount: `UPDATE Order SET refundedPaise = refundedPaise + x WHERE refundedPaise + x <= totalPaise`
   (concurrency-safe), create `Refund` (`PENDING`, our id).
2. Call `payments.refund(paymentId, { amount, notes: { refundId } })`.
3. Settle from the response or later from `refund.processed` / `refund.failed` webhooks; failure releases the
   reserved amount.
4. If the call's outcome is unknown (timeout, network, 5xx, 429) the refund stays `PENDING` with the amount still
   reserved, and a `payments.reconcile-refund` job lists the payment's refunds (`payments.fetchMultipleRefund`) and
   matches `notes.refundId` **before** any retry, so a refund is never issued twice. If Razorpay has no such refund
   10 minutes later it was never created: the refund is marked failed and the amount released. A definite rejection
   (4xx other than 408/429) fails immediately and releases the amount. Duplicate-payment refunds (run as a retryable
   job) first check Razorpay's refund list for an existing duplicate refund.
5. Scheduled `payments.reconcile` (every 15 min): online attempts still unconfirmed after 10 minutes are checked with
   Razorpay (lost callback + missed webhook), and refunds pending for more than 15 minutes are reconciled.
   COD refunds are recorded as `MANUAL` (bank/UPI transfer done outside the system).

## 6. Data stored / never stored

Stored: internal ids, Razorpay order/payment/refund ids, method family (upi/card/netbanking/wallet), amounts,
currency, statuses, error code/description, event payloads (Razorpay webhook payloads contain no card
numbers/CVV). Never stored: card numbers, CVV, UPI PINs, key secret (env only, server only).

## 7. Configuration

| Variable                                  | Purpose                                           |
| ----------------------------------------- | ------------------------------------------------- |
| `PAYMENT_GATEWAY`                         | `razorpay` or `mock` (mock refused in production) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | API keys (test keys `rzp_test_…` in development)  |
| `RAZORPAY_WEBHOOK_SECRET` (+ `_PREVIOUS`) | webhook signature secret(s)                       |
| `PAYMENT_EXPIRY_MINUTES`                  | stock reservation window for unpaid online orders |

Dashboard setup: Settings → Webhooks → URL `https://<domain>/api/webhooks/razorpay`, secret, events above.
Keep **auto-capture enabled** (Settings → Payment Capture) — the system confirms orders on capture.

## 8. Verification status

| Item                                                   | Status                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| Signature algorithms                                   | unit-tested (tamper, wrong secret, raw-body sensitivity)             |
| Full workflow incl. duplicates, races, delays, refunds | integration-tested with `MockGateway` (signed payloads)              |
| Fast-ack webhooks, rotation, redelivery, retries       | integration-tested (Phase 8)                                         |
| Refund timeouts (after/before creation), rejections    | integration-tested with a failure-injecting gateway (Phase 8)        |
| Browser flow                                           | Playwright with the mock checkout modal                              |
| Real adapter (request mapping, error classes, timeout) | unit-tested with a fake Razorpay SDK client (Phase 14)               |
| Real Razorpay **test mode** round trip                 | **not yet verified** — needs `rzp_test_` keys (see README checklist) |
| Live mode                                              | not in scope until launch                                            |
