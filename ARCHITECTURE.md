# Shayvera — Architecture

## 1. Overview

Shayvera is a single Next.js (App Router) application that contains:

- **Storefront** (`src/app/(store)`) — public catalog, cart, checkout, customer account.
- **Admin dashboard** (`src/app/admin`) — role-protected back office.
- **HTTP API** (`src/app/api`) — Route Handlers used by client components, Razorpay webhooks, health checks.

It is a deliberately *modular monolith*: one deployable, one PostgreSQL database, no
microservices, no Redis, no queue. Business logic lives in framework-agnostic service
modules so it can be unit/integration tested without HTTP.

```
Browser ──► proxy.ts (optimistic auth redirects, security headers)
        ──► Server Components (read via services/queries)
        ──► Route Handlers (/api/**) ──► zod validation ──► services ──► Prisma ──► PostgreSQL
Razorpay ─► /api/webhooks/razorpay (raw body HMAC verification) ──► payment service
```

## 2. Technology decisions (verified November 2026)

| Concern | Choice | Pinned version | Notes |
|---|---|---|---|
| Framework | Next.js App Router | 16.4.3 | 16.4.5 was 2 days old at project start; 16.4.3 is ~2 weeks old. `proxy.ts` replaces `middleware.ts` in v16. |
| UI runtime | React | 19.3.x | Bundled with create-next-app 16.4.3. |
| Language | TypeScript strict | 5.x | `strict`, `noUncheckedIndexedAccess`. |
| Styling | Tailwind CSS v4 + shadcn/ui + lucide-react | 4.x | Design tokens via CSS variables (`globals.css`). |
| Validation | Zod | 4.x | Same major as Better Auth's dependency. |
| ORM | Prisma | 6.19.3 | Prisma 8 is still RC (`latest` tag points to an RC); Prisma 7 requires driver adapters and a new generator. 6.19 is the mature stable line and is inside Better Auth's peer range (`^5 \|\| ^6 \|\| ^7`). Upgrade path to 7 documented in PROJECT_PLAN. |
| Auth | Better Auth + Prisma adapter | 1.7.13 | Peer ranges: next ^14–^16, prisma ^5–^7. |
| Payments | Razorpay Node SDK + Checkout.js | 2.9.x | Test mode; secrets server-side only. |
| Images | sharp | bundled with Next | Decode + re-encode every upload. |
| Tests | Vitest, Playwright | 4.x / 1.6x | Integration tests run against a real PostgreSQL test DB. |

**Cache Components disabled.** Next 16.4 scaffolds with `cacheComponents: true`. This app is
dominated by per-session data (cart badge, account, admin), so we use the classic dynamic
rendering model (`cacheComponents: false`). Catalog pages are dynamic and rely on indexed
queries + pagination. Adopting Cache Components later is a contained optimisation.

## 3. Source layout

```
prisma/                 schema.prisma, migrations/, seed.ts
scripts/                create-admin.ts, reconcile-payments.ts
src/
  app/
    (store)/            storefront route group (shared header/footer layout)
    (auth)/             login, register, forgot/reset password
    admin/              admin dashboard (layout enforces ADMIN role server-side)
    api/                route handlers
    media/[...key]/     serves uploaded files from local storage
  components/
    ui/                 shadcn/ui primitives
    store/ admin/ shared/
  lib/                  cross-cutting utilities (env, db, money, errors, api helpers, auth)
  server/
    services/           business logic (catalog, cart, pricing, checkout, orders, payments, …)
    queries/            read models for server components
    storage/            StorageProvider abstraction (local disk now, cloud later)
    payments/           Razorpay gateway abstraction (real + mock for tests)
    email/              email abstraction (dev outbox table + console)
  proxy.ts
tests/
  unit/ integration/ e2e/
```

## 4. Layering rules

1. **Route Handlers / Server Components** — parse input (zod), resolve the session, call a service, map
   errors to HTTP. No business rules here.
2. **Services** (`src/server/services`) — business rules, transactions, authorization *assertions*
   that depend on data ownership (e.g. "order belongs to user").
3. **Prisma** — the only persistence API. Raw SQL only through tagged `$queryRaw` (parameterised).

Authorization is enforced server-side twice: route/layout guards (`requireUser`, `requireAdmin`) and
ownership filters in every customer query (`where: { userId }`).

## 5. API conventions

- Base path `/api`. JSON in/out. Resource-oriented paths (`/api/cart/items/:id`).
- Success: `200/201` with `{ "data": … }`.
- Error: `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details"?: … } }` with
  `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict
  (stock/state), `413` payload too large, `422` business rule, `429` rate limited, `500` internal.
- Internal errors never leak stack traces; they are logged server-side with a request id.
- State-changing requests require a same-origin `Origin` header (CSRF defence for cookie auth);
  webhooks are exempt and authenticated by HMAC instead.
- Idempotency: checkout requires an `idempotencyKey` (UUID generated client-side per checkout attempt).

## 6. Money, tax, pricing

- All money is stored as **integer paise** (`Int`). No floats. Percentages stored as **basis points**.
- One pure pricing engine (`src/server/services/pricing.ts`) computes subtotal, product discounts,
  coupon discount, shipping, COD fee, GST (CGST/SGST vs IGST) and total. The same function is used
  for cart display and for order creation; the server always recomputes — the client never sends
  amounts.
- GST is configurable (`gstEnabled`, `pricesIncludeTax`, per-product rate). Intra-state (store state
  == shipping state) → CGST+SGST split; inter-state → IGST. Rounding: per line, half-up to paise.

## 7. Order & payment lifecycle

```
            ┌─────────── cancel / payment expired ───────────┐
PENDING ──► CONFIRMED ──► PROCESSING ──► SHIPPED ──► DELIVERED ──► REFUNDED
   │            │              │                                     ▲
   └────────────┴──────────────┴──► CANCELLED ──(if paid)────────────┘
```

- **COD**: order is created `CONFIRMED`, payment `PENDING`; becomes `PAID` when marked delivered.
- **Razorpay**: order created `PENDING` (stock reserved, `paymentExpiresAt` = +30 min); a Razorpay
  order is created server-side. Order moves to `CONFIRMED` only on *verified* evidence: a valid
  checkout signature **and** captured status fetched from Razorpay, or a signature-verified
  `payment.captured` / `order.paid` webhook. Failed payments keep the order `PENDING` so the
  customer can retry until expiry; expired orders are cancelled and stock released.
- **Late capture** for an already-cancelled order: stock is re-reserved if available and the
  order is confirmed; otherwise a refund is initiated and flagged for admin.
- Transitions are validated by a single state machine (`order-status.ts`); invalid transitions → 409.
- Every transition writes `OrderStatusHistory`.

## 8. Inventory concurrency

Stock decrements use a conditional atomic update inside the order transaction:

```sql
UPDATE "Inventory" SET "quantityOnHand" = "quantityOnHand" - $n
WHERE "variantId" = $id AND "quantityOnHand" >= $n
```

(Prisma `updateMany` with `quantityOnHand: { gte: n }`.) If the affected row count is 0 the whole
transaction rolls back with `OUT_OF_STOCK`. This is safe under concurrent checkouts without
explicit row locks. Every change writes an `InventoryTransaction` ledger row.

## 9. Authentication & authorization

- Better Auth (email + password, scrypt hashing, DB sessions, httpOnly/SameSite=Lax cookies,
  `Secure` in production).
- `role` (`CUSTOMER` | `ADMIN`) is an additional user field with `input: false` — it cannot be set
  via sign-up. Admins are provisioned only with `npm run admin:create`.
- Disabled accounts are blocked at session creation (database hook) and on every guarded request.
- `proxy.ts` does optimistic cookie-presence redirects only; real checks happen in layouts,
  route handlers and services.

## 10. Storage

`StorageProvider` interface (`put`, `delete`, `getStream`, `publicUrl`). `LocalStorageProvider`
writes to `./storage/uploads` (outside `public/`, served by `/media/[...key]`). Uploads are
validated by size, extension, magic bytes and a full decode via sharp, then re-encoded to WebP
(strips metadata and polyglot payloads). A Cloudinary/S3 provider can be added by implementing
the interface and switching `STORAGE_DRIVER`.

## 11. Email

`EmailService` writes every message to the `OutboundEmail` table and logs a redacted line in
development. A real provider (SES, Resend, …) plugs in later behind the same interface.

## 12. Rate limiting

Better Auth's built-in limiter (database storage) protects auth endpoints. Application endpoints
(checkout, coupon validation, contact, newsletter, uploads) use a PostgreSQL-backed fixed-window
limiter (`RateLimitBucket`) so it works across multiple instances without Redis.

## 13. Background work

No queue. Time-based work (expiring unpaid orders) runs opportunistically (on checkout and admin
dashboard requests) and via `npm run jobs:reconcile`, which can be scheduled with cron/Task
Scheduler in production.
