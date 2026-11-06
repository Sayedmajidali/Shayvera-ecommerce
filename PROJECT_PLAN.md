# Project Plan — v2 (scalable platform)

Shayvera Foods e-commerce platform. v1 (Phases 0–13, Nov 2026) delivered a working local store. v2 implements
the expanded "production-grade, scalable platform" specification on top of it. This file is the roadmap; status
lives in `PROGRESS.md`.

## 1. Starting point (inspected 2026-11-06)

- Next.js 16.4 App Router, TypeScript strict, Tailwind 4 + shadcn/ui, Prisma 6.19 + PostgreSQL 16, Better Auth 1.7.
- 32 Prisma models, 3 migrations; services in `src/server/services` (20 files), 40 route handlers, 178 unit +
  integration tests, 29 Playwright tests, all passing.
- Already production-quality and kept: pricing engine (paise, GST), cart, idempotent checkout with conditional
  stock updates, Razorpay (signature + server fetch + webhooks + reconciliation + refunds), admin CRUD,
  invoices, security controls, SEO/a11y.
- Network: Razorpay and Shiprocket APIs/docs reachable since 2026-11-06 (new "Shayvera-ecommerce" cloud
  environment). No provider credentials are configured.

## 2. Gap analysis against the v2 specification

| Area                    | v1 state                                                | v2 work                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture            | services folder, implicit boundaries                    | **domain modules** (`src/server/modules/*`) with public entry points; `src/server/platform/*` for cross-cutting infra                                                                                                                                        |
| Background work         | fire-and-forget promises (emails), opportunistic sweeps | **PostgreSQL job queue + transactional outbox**, separate worker process, retries with backoff + jitter, dead letters, admin retry                                                                                                                           |
| Observability           | structured logger, request id only in errors            | request **correlation IDs** via AsyncLocalStorage, `x-request-id`, integration failure logs, monitoring hook, worker heartbeat in health check                                                                                                               |
| Admin RBAC              | single ADMIN role                                       | **AdminRole + permissions**, admin user management                                                                                                                                                                                                           |
| Storefront              | no wishlist / Buy Now / specs / tracking                | wishlist, Buy Now, specifications (ProductAttribute), shipment tracking, invoice download, cancel/return requests                                                                                                                                            |
| Inventory               | stock decremented at order placement                    | explicit **reservation → deduction → release** model (`InventoryReservation`, `quantityReserved`), reconciliation job                                                                                                                                        |
| Orders                  | 7 statuses                                              | spec's 14 statuses with controlled transitions; order / payment / shipment / refund statuses kept separate                                                                                                                                                   |
| Cancellations & returns | customer cancels directly (≤ CONFIRMED)                 | request → admin approval → (shipment cancel / return pickup) → refund; `ReturnRequest` entity                                                                                                                                                                |
| Payments                | complete, inline webhook side effects                   | ack webhooks fast (Razorpay requires < 5 s) and queue follow-ups; refund idempotency; previous-secret support; payments dashboard                                                                                                                            |
| Shipping                | manual tracking only                                    | **Shiprocket module**: provider interface, Shiprocket adapter (official API), mock adapter, serviceability, shipment creation (idempotent), AWB, pickup, label, manifest, tracking sync, cancel, returns, webhooks, status normalisation, shipping dashboard |
| Notifications           | dev email outbox                                        | `Notification` + `NotificationLog`, queued delivery, provider interface                                                                                                                                                                                      |
| Storage                 | local disk only                                         | S3-compatible provider for production (no local FS dependency)                                                                                                                                                                                               |
| Caching                 | none                                                    | cache abstraction (in-process TTL now, Redis-ready) for public, non-personal data                                                                                                                                                                            |
| Deployment prep         | docs only                                               | Dockerfile (standalone), production compose (app, worker, reverse proxy), runbooks                                                                                                                                                                           |
| Docs                    | 8 files                                                 | + `PAYMENT_INTEGRATION.md`, `SHIPPING_INTEGRATION.md`, `PRODUCTION_READINESS.md`                                                                                                                                                                             |

## 3. Roadmap (v2 phases)

Each phase ends with: typecheck, lint, unit + integration tests green, `PROGRESS.md` updated, commit + push.

| Phase | Scope                                                                                                                                               | Acceptance                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0     | Discovery, gap analysis, architecture/module boundaries, DB design, compatibility, Razorpay + Shiprocket plans                                      | docs committed                                                                                            |
| 1     | Foundation: module restructure, platform layer (job queue + outbox + worker, request context, retry/timeout HTTP client, cache), Docker build files | existing tests green after restructure; job queue tests (claim, retry, backoff, dead-letter, concurrency) |
| 2     | Auth: AdminRole/permissions, permission-checked admin APIs/pages, admin user management                                                             | RBAC integration tests                                                                                    |
| 3     | Storefront: wishlist, Buy Now, specifications, tracking + invoice + request UIs                                                                     | E2E + integration                                                                                         |
| 4     | Catalog: ProductAttribute, package weight/dimensions, WooCommerce catalog importer (real products from shayvera.in)                                 | CRUD + importer tests                                                                                     |
| 5     | Inventory & pricing: reservations, deduction at fulfilment, release, reconciliation job                                                             | concurrency + lifecycle tests                                                                             |
| 6     | Cart, coupons, checkout: serviceability check, delivery estimate, COD serviceability                                                                | checkout tests                                                                                            |
| 7     | Order lifecycle & COD: 14-status machine, cancellation requests + approval                                                                          | transition + lifecycle tests                                                                              |
| 8     | Razorpay: fast-ack webhooks + queued follow-ups, refund idempotency, secret rotation, payments dashboard                                            | mock-gateway tests; live test-mode checklist                                                              |
| 9     | Shiprocket: full module (see `SHIPPING_INTEGRATION.md`)                                                                                             | mocked adapter tests incl. timeout, duplicate, invalid response, outage, webhooks                         |
| 10    | Admin: payments, shipments, returns, reports, admin users dashboards                                                                                | admin tests                                                                                               |
| 11    | Returns, cancellations, invoices, notifications                                                                                                     | workflow tests                                                                                            |
| 12    | Security hardening & reliability review                                                                                                             | updated `SECURITY_REVIEW.md`                                                                              |
| 13    | Performance, SEO, accessibility, observability                                                                                                      | axe + perf checks                                                                                         |
| 14    | Unit, integration, concurrency, E2E consolidation                                                                                                   | `QA_REPORT.md`                                                                                            |
| 15    | Documentation, final review, `PRODUCTION_READINESS.md`                                                                                              | all docs                                                                                                  |

## 4. Verification honesty

Every integration feature is classified in docs as **implemented**, **tested with mocks**, **tested against the
real provider**, or **unverified**. Shiprocket has **no sandbox**: its API acts on the live account, so real-API
verification requires the business's credentials and creates real (cancellable) shipments — see
`SHIPPING_INTEGRATION.md` §9.

## 5. Out of scope until production deployment

Hosting/VPS, domain, TLS certificates, managed database, real email/SMS provider accounts, Razorpay live keys,
Shiprocket live verification, monitoring SaaS accounts. Each is prepared (configuration + docs) but not provisioned.
