# Project Plan

Production-grade e-commerce platform for a small Indian business selling general physical products.
Built locally first; production deployment is a separate later phase.

## Phase roadmap

**Status (2026-11-05): Phases 0–13 complete for local development.** See PROGRESS.md and QA_REPORT.md.

| Phase | Scope                                                                                                                                                                            | Exit criteria                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0     | Discovery & architecture                                                                                                                                                         | ARCHITECTURE.md, DATABASE_DESIGN.md, this plan, PROGRESS.md          |
| 1     | Foundation: Next.js 16, TS strict, Tailwind v4, shadcn/ui, ESLint/Prettier, Docker Postgres, Prisma, env validation, design tokens, layout, error/not-found pages, `/api/health` | dev server runs, DB connects, typecheck/lint/build pass              |
| 2     | Full schema + migrations, Better Auth (register/login/logout/reset/profile), roles, admin provisioning script                                                                    | auth flows work; RBAC + data isolation tests pass                    |
| 3     | Storefront UI (17 pages, homepage sections) on seeded DB data                                                                                                                    | pages render from PostgreSQL, responsive, empty/loading/error states |
| 4     | Catalog management: product/category CRUD, variants, images (validated uploads), search/filter/sort/pagination                                                                   | CRUD + upload validation tests pass                                  |
| 5     | Cart (guest + user, merge) & centralised pricing engine                                                                                                                          | pricing unit tests, stock/concurrency integration tests              |
| 6     | Checkout, orders, COD, state machine, idempotency                                                                                                                                | full COD purchase verified in DB                                     |
| 7     | Razorpay test mode: orders, signature verification, webhooks, reconciliation, refunds                                                                                            | success/failure/duplicate/delayed webhook tests                      |
| 8     | Admin dashboard: analytics, products, orders, customers, coupons, inventory, settings, audit log                                                                                 | admin CRUD + access-denied tests                                     |
| 9     | India: INR, phone/PIN validation, GST CGST/SGST/IGST, GSTIN, invoices                                                                                                            | tax unit tests, invoice generation                                   |
| 10    | Security hardening + SECURITY_REVIEW.md                                                                                                                                          | review documented, `npm audit` reviewed                              |
| 11    | Testing & QA_REPORT.md                                                                                                                                                           | lint, typecheck, unit, integration, e2e, build all pass              |
| 12    | Performance, SEO (metadata, sitemap, robots, JSON-LD), accessibility, UI review                                                                                                  |                                                                      |
| 13    | README, API_DOCUMENTATION.md, handover                                                                                                                                           |                                                                      |

## Key decisions

- Modular monolith in Next.js; no microservices/Redis/queues.
- Integer paise everywhere; pricing engine is pure and shared by cart and checkout.
- Stock reserved at order creation (COD and online); released on cancel/expiry/failure.
- Razorpay orders are confirmed only on server-verified evidence.
- Local disk storage behind a provider interface; uploads re-encoded with sharp.
- Email goes to an `OutboundEmail` table in development (no paid email service).
- Cache Components disabled (session-heavy app); dynamic rendering with indexed queries.

## Future production tasks (out of scope now)

Hosting/VPS, domain + TLS, managed PostgreSQL with backups/PITR, object storage (Cloudinary/S3),
transactional email provider, Razorpay live keys + webhook registration on public URL, monitoring
(error tracking, uptime, logs), scheduled reconciliation job, CSP tuning with nonces, legal review
of GST/invoice settings and policy pages, Prisma 7 upgrade evaluation (clears the CLI `deepmerge-ts` advisory),
admin MFA, email verification, review submission/moderation, courier API integration, stored PDF invoices.
