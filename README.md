# Shayvera Foods — E-Commerce Platform

_Rooted in Trust, Crafted with Care._ A production-grade online store for **Shayvera Foods** — spices and
masalas, dry fruits, nuts and roasted makhana — with a customer storefront and an admin dashboard in one
Next.js application, backed by PostgreSQL.

- **Storefront:** catalog with search/filters/sorting, product variants, guest & account carts, coupons,
  checkout with saved addresses, **Razorpay** online payments and **Cash on Delivery**, order tracking,
  customer accounts, content and policy pages.
- **Admin:** analytics dashboard, products/variants/images, categories, inventory ledger, orders (status,
  shipments, refunds, invoices, payment reconciliation), customers, coupons, store/GST/COD settings, audit log.
- **India-ready:** INR formatting, Indian mobile/PIN validation, configurable GST (CGST/SGST vs IGST),
  GSTIN validation, financial-year invoice numbering, free-shipping threshold, COD rules.
- **Food labelling:** per-product ingredients, net quantity (weight variants), best-before/shelf life, storage,
  country of origin and FSSAI veg mark on product pages; FSSAI licence number in footer, product pages and invoices.

> Status: **development-complete for local use**. It is _not_ production-deployment-ready until the items in
> [Production deployment tasks](#production-deployment-tasks) are done. See `PROGRESS.md` for the phase log.

---

## Contents

- [Architecture](#architecture) · [Technology stack](#technology-stack) · [Prerequisites](#prerequisites)
- [Windows setup](#windows-setup) · [Environment variables](#environment-variables)
- [Database: Docker, migrations, seed](#database) · [Authentication & admin](#authentication--admin-accounts)
- [Razorpay test mode](#razorpay-test-mode) · [Running the app](#running-the-app) · [Tests](#tests)
- [Project structure](#project-structure) · [Troubleshooting](#troubleshooting) · [Handover](#handover)

Other documents: `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_DOCUMENTATION.md`, `SECURITY_REVIEW.md`,
`QA_REPORT.md`, `PROJECT_PLAN.md`, `PROGRESS.md`.

## Architecture

One Next.js App Router application (modular monolith) with three surfaces — storefront (`src/app/(store)`),
admin (`src/app/admin`) and HTTP API (`src/app/api`). Business logic lives in framework-independent services
(`src/server/services`) using Prisma; every money/stock operation runs in a database transaction with
concurrency-safe conditional updates. Details: `ARCHITECTURE.md`.

```
Browser ─► proxy.ts (optimistic auth redirect) ─► Server Components ─► services ─► Prisma ─► PostgreSQL
        └► Route Handlers /api/** (zod, auth, CSRF) ─┘
Razorpay ─► /api/webhooks/razorpay (HMAC over raw body, idempotent)
```

## Technology stack

| Layer      | Choice (pinned)                                                                  |
| ---------- | -------------------------------------------------------------------------------- |
| Framework  | Next.js 16.4.3 (App Router, React 19.3, Server Components, `proxy.ts`)           |
| Language   | TypeScript 5 (strict, `noUncheckedIndexedAccess`)                                |
| UI         | Tailwind CSS 4, shadcn/ui (Radix primitives), lucide-react, sonner, Recharts     |
| Validation | Zod 4                                                                            |
| Database   | PostgreSQL 16 + Prisma 6.19.3                                                    |
| Auth       | Better Auth 1.7.13 (email/password, DB sessions, roles)                          |
| Payments   | Razorpay (Node SDK + Checkout.js), test mode + offline simulator                 |
| Images     | sharp (validation + WebP re-encoding), local storage behind a provider interface |
| Tests      | Vitest 4 (unit + integration on real PostgreSQL), Playwright 1.63 (+ axe-core)   |

Why these versions: see `ARCHITECTURE.md` §2.

## Prerequisites

- **Windows 10/11** with **Node.js 22 LTS** (≥ 20.9) and npm 10 — <https://nodejs.org>
- **Docker Desktop** with the **WSL 2** backend (for PostgreSQL) — <https://www.docker.com/products/docker-desktop>
- **Git**
- Optional: a free **Razorpay** account in Test Mode for online payments.

Check: `node -v`, `npm -v`, `docker --version`, `docker compose version`.

## Windows setup

Run these in **PowerShell** (or Windows Terminal) from the folder where you keep projects.

```bash
git clone https://github.com/sayedmajidali/Shayvera-ecommerce.git
```

```bash
cd Shayvera-ecommerce
```

```bash
copy .env.example .env
```

Edit `.env` (see next section). At minimum set `BETTER_AUTH_SECRET` to a random value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Install dependencies (also generates the Prisma client):

```bash
npm install
```

Start PostgreSQL in Docker (bound to `127.0.0.1:5432` only), apply migrations and seed demo data:

```bash
npm run db:up
```

```bash
npm run db:deploy
```

```bash
npm run db:seed
```

Create your administrator account (you will be prompted for a password, hidden):

```bash
npm run admin:create -- --email you@example.com --name "Your Name"
```

Start the app:

```bash
npm run dev
```

Open <http://localhost:3000>. Admin dashboard: <http://localhost:3000/admin>.
Demo customer: `customer@shayvera.local` / `Customer123!`.

> Next.js runs directly on Windows; only PostgreSQL runs in Docker. If port 5432 is already taken by a local
> PostgreSQL install, stop that service or change the port mapping in `docker-compose.yml` and `DATABASE_URL`.

## Environment variables

All variables are documented in `.env.example` and validated at runtime (`src/lib/env.ts`). Never commit `.env`.

| Variable                                              | Required            | Description                                                                                        |
| ----------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                                 | yes                 | Public base URL (`http://localhost:3000` locally). Used for links, canonical URLs, emails.         |
| `DATABASE_URL`                                        | yes                 | PostgreSQL connection string for the app.                                                          |
| `DATABASE_URL_TEST`                                   | tests               | Separate DB for integration tests (truncated on every test).                                       |
| `DATABASE_URL_E2E`                                    | tests               | Separate DB for Playwright (reset + seeded each run; name must contain `e2e`).                     |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | docker              | Used by `docker-compose.yml`.                                                                      |
| `BETTER_AUTH_SECRET`                                  | yes                 | ≥ 32 random characters. Signs sessions and guest order links. Rotating it signs everyone out.      |
| `BETTER_AUTH_URL`                                     | yes                 | Same as the app URL.                                                                               |
| `PAYMENT_GATEWAY`                                     | yes                 | `razorpay` (real API, test or live keys) or `mock` (offline simulator; **refused in production**). |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`             | for online payments | From Razorpay Dashboard → Settings → API Keys (Test Mode). The secret never reaches the browser.   |
| `RAZORPAY_WEBHOOK_SECRET`                             | for webhooks        | Secret you set when creating the webhook in the dashboard.                                         |
| `PAYMENT_EXPIRY_MINUTES`                              | no (30)             | How long unpaid online orders keep stock reserved.                                                 |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR`                | no                  | `local` / `./storage/uploads` (uploaded images; git-ignored).                                      |
| `UPLOAD_MAX_BYTES`                                    | no (5 MB)           | Max image upload size.                                                                             |
| `TRUSTED_PROXY_HOPS`                                  | no (1)              | Number of reverse proxies in front of the app (for client IP / rate limits).                       |
| `LOG_LEVEL`                                           | no (info)           | `debug`, `info`, `warn`, `error`.                                                                  |

Test-only switches: `AUTH_RATE_LIMIT=off`, `APP_RATE_LIMIT=off`, `SEED_DEMO_ORDERS=false`, `E2E_TEST_MODE=true`.

## Database

| Task                                                        | Command                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Start / stop PostgreSQL                                     | `npm run db:up` / `npm run db:down` (data persists in the `shayvera_pgdata` volume) |
| Apply migrations (non-interactive)                          | `npm run db:deploy`                                                                 |
| Create a new migration after editing `prisma/schema.prisma` | `npm run db:migrate -- --name describe_change`                                      |
| Seed (idempotent; skips existing slugs)                     | `npm run db:seed`                                                                   |
| Browse data                                                 | `npm run db:studio`                                                                 |
| ⚠️ Drop and recreate the dev database                       | `npm run db:reset` (destroys all local data)                                        |

The Docker init script also creates `shayvera_test` and `shayvera_e2e`. If your volume was created before
that script existed, create them once:

```bash
docker exec -it shayvera-postgres psql -U shayvera -d shayvera -c "CREATE DATABASE shayvera_test;" -c "CREATE DATABASE shayvera_e2e;"
```

**Seed data (demo only):** 6 food categories (Whole Spices, Masalas & Powders, Dry Fruits, Nuts, Roasted Makhana,
Gift Boxes), 23 products with weight variants, food labelling, stock and demo reviews; coupons (`WELCOME10`,
`FLAT200`, expired `EXPIRED50`); a demo customer and ~45 historical orders created through the real checkout services
so the dashboard has data. **Product names, prices, stock, GST rates, HSN codes, ingredients and reviews are
placeholders** — replace them with the real catalog in Admin → Products (and have tax codes reviewed). Product images
are generated illustrations — upload real photos from the product editor. Business contact details, address, state,
GSTIN and FSSAI number are deliberately not seeded: enter them in Admin → Settings. Money is stored in **paise**; see `DATABASE_DESIGN.md`.

## Authentication & admin accounts

- Customers register at `/register`; sessions last 14 days (sliding). Password reset emails are written to the
  **development outbox** (Admin → _Messages & emails_) — no email provider is configured yet.
- There is **no public admin sign-up**. Bootstrap the first **Owner** from the command line:
  `npm run admin:create -- --email … --name "…"` (password via hidden prompt or `ADMIN_PASSWORD` env var).
  Running it for an existing email promotes that user to Owner and resets the password.
- Further staff are invited from **Admin → Staff & roles**: they receive an email to set their own password and get
  a role. Built-in roles: **Owner** (everything), **Operations**, **Catalog**, **Support**, **Accounts**; custom roles
  can be created with any of 18 permissions. Every admin page and API checks its permission on the server; staff who
  open a page outside their role see a "no access" page. The last active Owner cannot be demoted, disabled or
  removed, and nobody can change their own access.
- Disable a customer in Admin → Customers (signs them out everywhere).

## Razorpay test mode

**Offline (default for development):** `PAYMENT_GATEWAY="mock"`. "Pay online" opens a _Test payment_ dialog
that produces payloads signed exactly like Razorpay's, so the full server verification path runs without
network access.

**Real Razorpay test mode:**

1. Sign up at <https://dashboard.razorpay.com>, switch to **Test Mode**, create API keys.
2. In `.env`: `PAYMENT_GATEWAY="razorpay"`, `RAZORPAY_KEY_ID="rzp_test_…"`, `RAZORPAY_KEY_SECRET="…"`. Restart `npm run dev`.
3. Webhooks need a public URL. Expose your dev server with a tunnel (for example `cloudflared tunnel --url http://localhost:3000`
   or `ngrok http 3000`), then in Dashboard → Settings → Webhooks add `https://<tunnel>/api/webhooks/razorpay` with a
   secret and the events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
   Put the same secret in `RAZORPAY_WEBHOOK_SECRET`.
4. Checklist: pay with a test card/UPI (success) → order _Confirmed/Paid_; use a failing test method → order stays
   _Awaiting payment_ with "Complete payment"; close the modal → pay later from the order page; refund from Admin →
   order → _Refund_; check _Gateway events_ on the admin order page.

Payment rules: an order is marked paid only after the checkout signature is verified **and** the payment is fetched
from Razorpay with a matching amount, or after a signature-verified webhook. Unpaid online orders expire after
`PAYMENT_EXPIRY_MINUTES` (checked opportunistically and by `npm run jobs:reconcile`, which should be scheduled
every 5–10 minutes in production). Card data is never stored.

## Running the app

| Task                                              | Command                                                   |
| ------------------------------------------------- | --------------------------------------------------------- |
| Development server                                | `npm run dev` → <http://localhost:3000>                   |
| Production build / start                          | `npm run build` then `npm run start`                      |
| Lint / format / typecheck                         | `npm run lint` · `npm run format` · `npm run typecheck`   |
| Background job worker (production)                | `npm run worker`                                          |
| Import products from a WooCommerce site (dry run) | `npm run catalog:import-woo -- --url https://shayvera.in` |
| Expire stale unpaid orders now (one-off)          | `npm run jobs:reconcile`                                  |
| Health check (DB, job queue, worker heartbeat)    | `GET /api/health`                                         |

**Shipping / delivery checks.** `SHIPPING_PROVIDER` = `mock` (default in development: an offline courier simulator),
`manual` (default in production until Shiprocket is set up: staff enter courier and AWB, no coverage check) or
`shiprocket` (needs `SHIPROCKET_API_EMAIL` / `SHIPROCKET_API_PASSWORD` of a Shiprocket **API user**). Set the store
PIN code in Admin → Settings so checkout can check couriers from your warehouse. After adding real credentials, run the
read-only `npm run shipping:verify -- --from <store PIN> --to <customer PIN>` first. Shiprocket has no sandbox.
To book shipments, add the pickup location in Admin → Settings (its name must match the pickup nickname in Shiprocket),
set `SHIPROCKET_WEBHOOK_TOKEN` and configure the Shiprocket webhook to `https://<your domain>/api/webhooks/courier` with
that token. Bookings, pickups, labels and tracking are then managed from the order page and Admin → Shipments.

**Staff alerts and invoices.** In Admin → Settings → Numbering & alerts, add up to five staff email addresses to receive
new-order, cancellation/return-request, failed-refund and courier-problem emails plus a daily low-stock email, and choose
whether invoices are issued automatically on delivery. Refunding an invoiced order issues a credit note automatically
(`CN<FY>/00001`, prefix configurable). In development, all emails land in Admin → Messages & emails (dev outbox).

**Importing the existing catalog.** `npm run catalog:import-woo -- --url https://shayvera.in` reads the public
WooCommerce Store API and prints what it would do; add `--apply` to write. Imported products are **DRAFT with zero
stock**, keep their source price (the live site shows ₹64.98 for every product, which the importer flags as a likely
placeholder) and are linked by `sourceRef`, so re-running never duplicates them or overwrites anything already
published. Options: `--update-drafts`, `--map woo-category=our-category`, `--actor admin@email`. Before publishing,
set real prices, rename the "Default" variant to its pack size, add packed weight/box and stock. (Inside a sandbox that
requires an HTTP proxy, Node's `fetch` needs `NODE_USE_ENV_PROXY=1`.)

**Background jobs.** Order emails, unpaid-order expiry and maintenance run from a PostgreSQL job queue.
In development the Next.js server polls the queue itself (`JOB_RUNNER=inline`, the default when
`NODE_ENV=development`), so `npm run dev` is enough. In production run `npm run worker` as a second process
(`JOB_RUNNER=worker` is the production default); several workers can run safely. `/api/health` reports
`degraded` if the worker heartbeat is older than 2 minutes or due jobs wait longer than 15 minutes.

**Docker.** `Dockerfile` builds two targets — `web` (Next.js standalone server) and `worker` — and
`docker-compose.prod.yml` runs Postgres, a one-shot `migrate`, `web` and `worker` for staging/smoke tests
(`docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`). Hosting, TLS and
backups are not configured yet.

## Tests

```bash
npm run test:unit
```

```bash
npm run test:integration
```

```bash
npm run test:e2e
```

- **Unit** (77): pricing, GST, coupons, money, India validators, order state machine, signatures, security helpers.
- **Integration** (100): run route handlers and services against `DATABASE_URL_TEST` (truncated between tests),
  including concurrency tests (oversell, coupon limits, idempotent double submit, refunds).
- **E2E** (29): Playwright against a production build on port 3100 with `DATABASE_URL_E2E` and the mock gateway;
  includes axe accessibility scans. First run: Playwright uses its bundled Chromium (`npx playwright install chromium`
  if it is missing on your machine). HTML report: `npx playwright show-report`.

Results and coverage: `QA_REPORT.md`.

## Project structure

```
prisma/            schema.prisma · migrations/ · seed.ts · seed/ (catalog data, illustrations, demo orders)
scripts/           create-admin.ts · reconcile-payments.ts · worker.ts
src/app/(store)/   storefront pages        src/app/admin/   admin pages
src/app/api/       route handlers          src/app/(print)/ printable invoice
src/components/    ui/ (shadcn) · store/ · admin/ · shared/
src/lib/           env, auth, api helpers, money, india, validation
src/server/modules/<domain>/   business modules (catalog, cart, checkout, orders, payments, inventory, …)
src/server/platform/           db, logger, context, monitoring, http, cache, rate-limit, storage, jobs/
src/server/jobs/               job registry + schedules (composition root) and the polling loop
src/instrumentation.ts         starts the in-process job runner in development
src/proxy.ts       optimistic auth redirects
tests/             unit/ · integration/ · e2e/ · helpers/
```

## Troubleshooting

| Symptom                                                       | Fix                                                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration` on start                  | A required variable is missing/invalid — the message lists which. Compare with `.env.example`.                                          |
| `Can't reach database server at localhost:5432`               | `npm run db:up`; check `docker ps`; make sure no other PostgreSQL uses 5432.                                                            |
| Docker Desktop: "WSL 2 installation is incomplete"            | Run `wsl --install` (or `wsl --update`) in an elevated PowerShell, reboot, restart Docker Desktop.                                      |
| Images missing after cloning                                  | Uploaded/seeded images live in `storage/uploads` (git-ignored). Run `npm run db:seed` on a fresh database, or re-upload.                |
| `EPERM` / file locks on Windows during `npm install` or build | Stop `npm run dev`, close editors holding `node_modules`, re-run. Exclude the project from real-time antivirus scanning if it persists. |
| Integration tests refuse to run                               | Set `DATABASE_URL_TEST` to a _different_ database (e.g. `shayvera_test`).                                                               |
| E2E refuses to reset DB                                       | `DATABASE_URL_E2E` must point to a database whose name contains `e2e`.                                                                  |
| Razorpay modal does not open                                  | With `PAYMENT_GATEWAY=razorpay`, browser extensions/ad-blockers may block `checkout.razorpay.com`; check keys and the browser console.  |
| Webhooks rejected with 403                                    | `RAZORPAY_WEBHOOK_SECRET` must match the dashboard webhook secret exactly.                                                              |
| Signed out after changing `.env`                              | Changing `BETTER_AUTH_SECRET` invalidates sessions and guest order links (expected).                                                    |
| Line-ending warnings from Git                                 | The repo enforces LF via `.gitattributes`; `git config core.autocrlf false` avoids conversions.                                         |

## Handover

### Completed and tested

Everything in `PROJECT_PLAN.md` Phases 0–13: storefront, auth & RBAC, catalog management with secure uploads,
cart & server-side pricing, checkout & COD, Razorpay (via simulator + signed payloads), admin dashboard and
operations, GST/invoices/India rules, security hardening, unit/integration/E2E/accessibility tests, SEO.
Test evidence: `QA_REPORT.md`.

### Known limitations

- Real Razorpay round-trip and Docker Compose start-up were not executed in the build sandbox (network/daemon
  unavailable); run the checklists above locally.
- Emails go to a database outbox; no email provider; email verification not required.
- Product reviews are displayed (seeded) but there is no customer review submission or moderation UI yet.
- Local disk image storage (single instance only); invoices are printable HTML (browser "Save as PDF"), not stored PDFs.
- No courier API integration (manual tracking only); no multi-currency; no B2B GSTIN capture for buyers.
- CSP uses `'unsafe-inline'` for scripts (see SECURITY_REVIEW.md); no admin MFA.
- Legal pages, GST settings and invoice format are templates requiring professional review.

### Required credentials / configuration before going live

`BETTER_AUTH_SECRET` (new, random), production `DATABASE_URL`, Razorpay **live** keys + webhook secret,
public `NEXT_PUBLIC_APP_URL`/`BETTER_AUTH_URL` on HTTPS, store details/GST settings in Admin → Settings,
`TRUSTED_PROXY_HOPS` matching the hosting setup.

### Production deployment tasks

Hosting and HTTPS; managed PostgreSQL with automated backups/PITR and least-privilege roles; object storage
(implement `StorageProvider` for S3/Cloudinary); transactional email provider (implement `sendEmail`) and email
verification; scheduled `jobs:reconcile`; Razorpay live activation and webhook registration; nonce-based CSP;
admin MFA; error tracking, uptime monitoring and log retention; Prisma 7 upgrade evaluation (clears the CLI
advisory); legal/tax review; load testing.
