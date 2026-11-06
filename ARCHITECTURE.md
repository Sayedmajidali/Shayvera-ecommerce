# Architecture (v2)

## 1. Shape

A **modular monolith**: one Next.js application (storefront, admin, HTTP API) plus one **worker process**
(background jobs), sharing one PostgreSQL database. No microservices, Redis or queues until a demonstrated
need — but every module has explicit boundaries so it could be extracted later.

```
                    ┌────────────── Next.js (stateless, N instances) ──────────────┐
Browser ──HTTPS──►  │ proxy.ts → Server Components / Route Handlers                │
Razorpay  webhooks ►│   └─► modules/* (business logic) ─► platform/db (Prisma) ───┼─► PostgreSQL
Shiprocket webhooks►│   └─► enqueue jobs (transactional outbox, same DB tx)        │      ▲
                    └───────────────────────────────────────────────────────────────┘      │
                    ┌────────────── worker (1..N processes) ───────────────────────┐      │
                    │ claim jobs (FOR UPDATE SKIP LOCKED) → handlers → adapters ───┼──────┘
                    │ scheduled jobs: payment expiry, reservation expiry,          │──► Razorpay API
                    │ shipment tracking sync, reconciliation, cleanup              │──► Shiprocket API
                    └───────────────────────────────────────────────────────────────┘──► Email provider
```

Both processes are **stateless**: sessions, carts, rate limits, locks, idempotency records and jobs live in
PostgreSQL. Uploaded files go through a storage provider (local disk in development, S3-compatible in
production). The app can therefore scale horizontally behind a load balancer without code changes.

## 2. Technology (pinned)

| Concern    | Choice                                                  | Version                                      | Notes                                                                    |
| ---------- | ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Framework  | Next.js App Router                                      | 16.4.3                                       | `proxy.ts`; `cacheComponents` off (session-heavy app)                    |
| UI         | React 19.3, Tailwind 4, shadcn/ui (Radix), lucide-react |                                              |                                                                          |
| Language   | TypeScript strict + `noUncheckedIndexedAccess`          | 5.x                                          |                                                                          |
| Validation | Zod                                                     | 4.x                                          |                                                                          |
| ORM / DB   | Prisma                                                  | 6.19.3                                       | PostgreSQL 16. Prisma 8 is RC; 7 needs driver adapters — upgrade tracked |
| Auth       | Better Auth                                             | 1.7.13                                       | DB sessions, roles via additional fields + AdminRole                     |
| Payments   | Razorpay Node SDK                                       | 2.9.x                                        | + Checkout.js                                                            |
| Shipping   | Shiprocket REST API (`apiv2.shiprocket.in/v1/external`) | official Postman collection, read 2026-11-06 | own fetch-based adapter (no SDK)                                         |
| Images     | sharp                                                   | bundled                                      |                                                                          |
| Tests      | Vitest 4, Playwright 1.63, axe-core                     |                                              |                                                                          |

## 3. Source layout

```
src/
  app/                 routes only: (store), admin, (print), api/*, media
  components/          ui (shadcn), store, admin, shared
  lib/                 framework-agnostic helpers: money, india, validation schemas, api envelope, env
  server/
    platform/          cross-cutting infrastructure — no business rules
      db.ts            Prisma client (+ read-replica hook)
      logger.ts, context.ts   structured logs + AsyncLocalStorage request/job context
      jobs/            queue (enqueue/claim/complete/fail), worker loop, scheduler, handler registry
      http.ts          fetch with timeout, retry (exponential backoff + full jitter) for idempotent calls
      cache.ts         Cache interface + in-process TTL implementation
      storage/         StorageProvider: local, s3
      rate-limit.ts, sequence.ts, monitoring.ts
    modules/           business domains — each exposes a small public API (index.ts)
      auth/            sessions, guards, admin roles & permissions, admin users
      customers/       profile, addresses, admin customer management
      catalog/         products, variants, attributes, images, categories, public queries, importer
      inventory/       reservations, ledger, adjustments, reconciliation
      pricing/         pricing engine, coupons evaluation, tax
      cart/            guest/user carts, wishlist
      checkout/        order placement, serviceability at checkout
      orders/          order state machine, history, access, admin operations
      payments/        payment orchestration + gateways/ (razorpay, mock), webhooks, refunds, reconciliation
      shipping/        fulfilment orchestration + providers/ (shiprocket, mock), status normalisation, webhooks
      returns/         cancellation & return requests
      invoices/        GST invoices
      notifications/   templates, queued delivery, providers/ (dev outbox, …)
      analytics/       dashboard, reports
      settings/        store configuration
      audit/           admin audit log
```

**Boundary rules.** Routes call module entry points, never Prisma directly (read-only page queries live in
the module's `queries.ts`). Modules may call other modules' public functions; they never reach into another
module's tables for writes except through that module. Provider-specific code lives only in
`payments/gateways/*` and `shipping/providers/*`; the rest of the system sees only the `PaymentGateway` and
`ShippingProvider` interfaces, so changing courier aggregator does not touch orders.

## 4. Cross-cutting decisions

| #   | Decision                                                                                                                                                                     | Rationale                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| D1  | **PostgreSQL job queue** (`Job` table) claimed with `FOR UPDATE SKIP LOCKED`; separate worker process (`npm run worker`)                                                     | durable, transactional with business writes, no Redis needed at this scale; multiple workers are safe |
| D2  | **Transactional outbox**: jobs are inserted in the same DB transaction as the state change (e.g. order placed → `notification.send`)                                         | no lost or phantom side effects                                                                       |
| D3  | Jobs are **idempotent** and carry an optional unique `dedupeKey`; retries use exponential backoff with full jitter, then `DEAD` (visible in admin, manually retryable)       | safe retries, no duplicate shipments/refunds                                                          |
| D4  | External calls: timeout + retry **only for idempotent requests**; non-idempotent creates use reconcile-before-retry (look the object up by our reference first)              | never double-create at a provider                                                                     |
| D5  | Webhooks: verify → store raw event (dedupe) → apply DB-only state change → enqueue follow-ups → respond 2xx fast                                                             | Razorpay requires a response within 5 s; providers retry                                              |
| D6  | Order, payment, shipment and refund have **separate status fields** with their own state machines; shipment events drive order status through an explicit mapping, never 1:1 | correctness, auditability                                                                             |
| D7  | Inventory **reservation → deduction → release** (see §6) with conditional updates                                                                                            | no overselling, no permanently blocked stock                                                          |
| D8  | Money as integer paise; percentages as basis points                                                                                                                          | no floating point                                                                                     |
| D9  | Request **correlation ID** (`x-request-id`) propagated via AsyncLocalStorage into every log line, job and outbound call                                                      | traceability across app, worker and providers                                                         |
| D10 | Caching only for public, non-personal data (catalog navigation, serviceability lookups) behind a `Cache` interface                                                           | correctness first; Redis can replace the in-process store later                                       |

## 5. Authorization

- `proxy.ts`: optimistic redirect only. Every admin page calls `requireAdminPage(permission)`; every admin API
  uses `adminRoute(permission, handler)`; customer APIs scope all queries by owner.
- Admins have an **AdminRole** with a set of **AdminPermission** values (e.g. `ORDERS_MANAGE`,
  `PAYMENTS_REFUND`, `SHIPPING_MANAGE`, `ADMINS_MANAGE`). Built-in roles: Owner, Operations, Catalog, Support,
  Accounts. The Owner role cannot be removed from the last owner.

## 6. Order, payment, shipment, refund lifecycles

**Order** (internal): `PENDING` (pending payment) · `PAYMENT_FAILED` · `CONFIRMED` · `PROCESSING` ·
`READY_TO_SHIP` · `SHIPPED` · `OUT_FOR_DELIVERY` · `DELIVERED` · `CANCELLATION_REQUESTED` · `CANCELLED` ·
`RETURN_REQUESTED` · `RETURNED` · `REFUND_PENDING` · `REFUNDED`. Transitions are defined in one table
(`modules/orders/order-status.ts`) and enforced with compare-and-set updates.

**Inventory**: available = `quantityOnHand − quantityReserved`.

1. _Reserve_ at order placement (COD and online): conditional increment of `quantityReserved`; an
   `InventoryReservation` row per line (online orders expire after `PAYMENT_EXPIRY_MINUTES`).
2. _Deduct_ when the shipment is handed over: `onHand −= q`, `reserved −= q`, reservation `CONSUMED`, ledger
   `ORDER_FULFILLED`. Trigger = entering `READY_TO_SHIP` (or `SHIPPED` when that step is skipped); deduction is
   idempotent. Cancelling a packed order that never reached the courier puts the units back (ledger
   `ORDER_CANCELLED`).
3. _Release_ on cancellation before deduction or payment expiry: `reserved −= q`, reservation `RELEASED`.
4. Returns are **not** restocked automatically; the admin records per-line restock when goods are received and
   inspected (ledger `RETURN`).
   A reconciliation job compares `quantityReserved` with active reservations and reports drift.

**Payment**: `PENDING → PAID | FAILED → PARTIALLY_REFUNDED | REFUNDED` (order level) and per attempt
`CREATED → AUTHORIZED → CAPTURED | FAILED → REFUNDED`. Paid only on verified evidence (see `PAYMENT_INTEGRATION.md`).

**Shipment**: normalised status (`PENDING`, `CREATED`, `AWB_ASSIGNED`, `PICKUP_SCHEDULED`, `PICKED_UP`,
`IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `UNDELIVERED`, `RTO_INITIATED`, `RTO_DELIVERED`, `CANCELLED`,
`LOST`, `DAMAGED`, `FAILED`) plus the raw provider status and an event history (see `SHIPPING_INTEGRATION.md`).

**Cancellation & returns** (business rules, explicit):

- Unpaid online order (`PENDING`/`PAYMENT_FAILED`): customer may cancel immediately → reservation released.
- Confirmed order before handover: customer _requests_ cancellation → admin approves → shipment cancelled at
  the provider (if created) → reservation released → refund initiated for paid orders (`REFUND_PENDING` →
  `REFUNDED` on gateway confirmation).
- Delivered order within the return window: customer _requests_ a return (reason) → admin approves → optional
  return pickup → admin marks received with per-line restock decision → refund.
- No refund or restock happens without one of these explicit steps.

## 7. Reliability & failure handling

Provider outages degrade gracefully: checkout falls back to configured shipping fees when serviceability is
unavailable; payment confirmation falls back to webhook/reconciliation; shipment operations are queued and
retried; failures appear on the admin Payments/Shipments dashboards with manual retry. All provider
references and raw responses (minus secrets) are stored so a crash between "provider succeeded" and "DB
committed" is recoverable by reconciliation.

## 8. Observability

Structured JSON logs (production) with `requestId`, `jobId`, `orderNumber` context; secrets and PII keys
redacted. `GET /api/health` reports DB status, queue backlog/age and worker heartbeat. A `monitoring.ts` hook
forwards exceptions to an error tracker when `SENTRY_DSN` (or equivalent) is configured.

## 9. Deployment readiness

`Dockerfile` (Next.js standalone output) runs either the web server or the worker (`npm run worker`).
`deploy/docker-compose.prod.yml` shows app ×N, worker, PostgreSQL (or managed DB), Caddy reverse proxy with
automatic HTTPS. Migrations run as a release step (`prisma migrate deploy`). See `PRODUCTION_READINESS.md`.
