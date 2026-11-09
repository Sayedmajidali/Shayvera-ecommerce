# Progress

## Environment (verified 2026-11-05, cloud dev container)

- Node.js v22.23.4, npm 10.9.9 (Node 22 LTS).
- Docker CLI 29.9 present, **daemon not available in this container** — PostgreSQL 16.15 run
  natively for verification. `docker-compose.yml` is provided for the Windows/Docker Desktop setup.
- Repository was empty at start.

## Phase 0 — Discovery & Architecture ✅

- Library compatibility checked against the npm registry:
  - Next.js 16.4.3, React 19.3, Better Auth 1.7.13 (peer: next ^16, prisma ^6), Prisma 6.19.3,
    Zod 4, Tailwind 4, Vitest 4, Playwright 1.6x.
  - Next 16 changes adopted: `proxy.ts` instead of middleware, async request APIs, flat ESLint config,
    `cacheComponents` (on by default in 16.4 scaffold) intentionally disabled.
- Created ARCHITECTURE.md, DATABASE_DESIGN.md, PROJECT_PLAN.md, PROGRESS.md.

## Phase 1 — Foundation ✅

- Next.js 16.4.3 App Router, TypeScript strict (+ `noUncheckedIndexedAccess`), Tailwind v4, ESLint flat config, Prettier.
- shadcn/ui: `components.json` + primitives in `src/components/ui` (Radix-based, new-york structure).
  The shadcn registry host is blocked in the build sandbox, so components were authored locally from the
  shadcn source patterns; `npx shadcn add …` works normally on a developer machine.
- `docker-compose.yml` (PostgreSQL 16, bound to 127.0.0.1, creates `shayvera_test`).
- Prisma 6.19.3 configured, initial migration, singleton client (`src/lib/db.ts`).
- Env validation with zod (`src/lib/env.ts`), `.env.example`.
- Design tokens (`globals.css`): warm ink/clay palette, Geist + Fraunces, radii, shadows.
- Root layout, `error.tsx`, `global-error.tsx`, `not-found.tsx`, security headers + CSP.
- `GET /api/health` (DB readiness).
- Verified: `tsc --noEmit` ✅, `eslint .` ✅, `next build` ✅, `next start` → `/api/health` 200 with DB up ✅.

## Phase 2 — Database & Authentication ✅

- Full relational schema (27 models) + migration `core_schema` with extra SQL CHECK constraints
  (non-negative stock, positive quantities, rating range, refund ≤ total, one default address per user).
- Better Auth 1.7 (email/password, scrypt, DB sessions 14d, DB-backed auth rate limiting,
  `role`/`status`/`phone` as `input:false` fields, disabled-account hook, reset-password with session revocation).
- Dev email outbox (`OutboundEmail` table) for password-reset mails.
- Guards: `getCurrentUser`/`requireUserPage`/`requireAdminPage` (pages), `requireUser(req)`/`requireAdmin(req)` (APIs).
- `proxy.ts` optimistic redirects for `/account` and `/admin`.
- Same-origin CSRF check + uniform JSON error envelope (`src/lib/api.ts`).
- Admin provisioning CLI: `npm run admin:create -- --email … --name …` (no public admin sign-up).
- Account APIs: profile (GET/PATCH), addresses CRUD with ownership enforcement.
- India validators: mobile, PIN, state codes, GSTIN checksum.
- Tests: `tests/integration/auth.test.ts` — 15 passing (registration, role escalation attempts, login,
  session persistence/sign-out, disabled accounts, password reset + token reuse, admin provisioning,
  401/403/CSRF, cross-customer address isolation, PIN/state validation).
- Auth UI pages are built with the storefront in Phase 3.

## Phase 3 — Design system & storefront ✅

- Storage abstraction (`src/server/storage`, local disk driver) + `/media/[...key]` route.
- Seed (`npm run db:seed`): 6 categories, 25 products with 60+ variants, generated studio-style
  illustrations (sharp, SVG→WebP; placeholders for real photography), reviews, coupons, demo customer.
- Storefront (route group `(store)`): header (search with live suggestions, mobile sheet nav, user menu,
  cart badge), footer + newsletter, homepage (hero, value props, categories, featured, promo, bestsellers,
  new arrivals, testimonials, newsletter), shop, category, search (filters: category/price/stock; 6 sorts;
  pagination), product detail (gallery, variant matrix with stock-aware options, qty, JSON-LD, reviews,
  related), login/register/forgot/reset, account (profile, password, address book), about, contact
  (persisted + rate limited), privacy, terms, shipping & returns. Loading skeletons, empty and error states.
- All product data comes from PostgreSQL. Cart, checkout and order pages are delivered with Phases 5–6
  where their functionality lives.
- Verified: every page 200 in dev, `/account` → 307 when signed out, no console errors (Playwright
  screenshots at 1440px and 390px).

## Phase 4 — Product & catalog management ✅

- Services: `catalog-admin.ts` (category CRUD, product create/update/delete-or-archive, variant
  add/update/delete-or-deactivate, image add/alt/delete/reorder, denormalised min price) and
  `inventory.ts` (atomic conditional stock moves + ledger, low-stock query). All admin mutations audit-logged.
- Upload pipeline (`image-upload.ts`): size cap, extension allow-list, magic-byte sniffing, full sharp decode,
  dimension and pixel-bomb limits, re-encode to WebP (metadata stripped), random storage keys.
- Admin APIs under `/api/admin/*` (categories, products, variants, stock, images) guarded by `adminRoute`.
  Public `/api/products` and `/api/products/[slug]`.
- Admin UI: shell with sidebar/mobile nav, products table (search/status/category/stock filters, pagination),
  new-product form with variants, product editor (images upload/reorder/alt/delete, variants, stock adjustments,
  details, SEO), categories manager. Destructive actions use confirmation dialogs.
- Tests: `tests/integration/catalog.test.ts` (15) — RBAC 401/403, category CRUD + non-empty delete block,
  product create + ledger, validation, duplicate SKU, min-price recompute, delete-vs-archive, stock never < 0,
  valid upload re-encoded, rejected disguised script/SVG/php/tiny/oversized/non-admin uploads, search/filter/
  sort/pagination. Total integration: 30 passing.

## Phase 5 — Cart & pricing engine ✅

- `pricing.ts`: pure engine — subtotal, MRP savings, coupon evaluation (percentage/fixed, caps, min order,
  windows, global and per-customer limits), pro-rata discount allocation (largest remainder), shipping with
  free threshold, COD fee, GST inclusive/exclusive with CGST/SGST vs IGST split, integer paise throughout.
- `cart.ts`: guest (httpOnly `shv_cart` token) and user carts, add/update/remove with stock + per-line limits,
  coupon apply/remove (rate limited), guest→user merge after login, `getCartView` re-validates availability,
  stock and coupon on every read; prices are always read live from the catalog.
- APIs: `GET /api/cart`, `POST /api/cart/items`, `PATCH|DELETE /api/cart/items/:id`, `POST|DELETE /api/cart/coupon`,
  `POST /api/cart/merge`. Cart page with quantity steppers, issues, coupon form and server-computed summary.
- Tests: unit 41 (money, India validators, allocation, tax, coupons, pricing); integration cart 16
  (cookie, stock limits, invalid quantities, draft products, cross-guest isolation, stock drop/deactivation,
  live price changes, coupon re-validation and rejection reasons, per-customer limits, merge, auth).

## Phase 6 — Checkout & order management ✅

- `checkout.ts` `placeOrder`: one DB transaction re-prices the server-side cart, validates stock/coupon/
  min-order/COD rules, generates the order number (`Sequence` table), snapshots items and addresses,
  reserves stock with conditional decrements, enforces coupon global limits with a conditional increment,
  records coupon usage, confirms COD orders, empties the cart and optionally saves the address.
- Idempotency: client UUID per attempt + unique `Order.idempotencyKey`; concurrent duplicates return the original order.
- Order state machine (`order-status.ts`) with compare-and-set transitions, status history, restock + coupon
  release on cancellation, sales counters, COD → PAID on delivery.
- Guest access to orders via HMAC capability token (`/order/:number?t=…`); owners via session.
- Pages: checkout (contact, saved/new address, billing, payment method, live server re-pricing by state and
  method), order confirmation/status (progress, shipment, actions), account order history + detail.
- APIs: `POST /api/checkout`, `GET /api/orders`, `GET /api/orders/:n`, `POST /api/orders/:n/cancel`, `POST /api/orders/:n/pay`.
- Tests: checkout 15 (snapshot/stock/ledger/email, client amounts ignored, idempotency under concurrency,
  validation, empty/out-of-stock, COD rules, GST intra/inter split, **8 buyers for 3 units → exactly 3 orders**,
  coupon limit race, unique order numbers, guest per-email coupon limit, owner/guest-token access, cancel +
  restock + coupon release, invalid transitions). Unit: state machine + financial year.
- Verified in a real browser: guest COD purchase → order `CONFIRMED`, stock decremented.

## Phase 7 — Razorpay integration ✅ (test mode; see limitation)

- Gateway abstraction (`src/server/payments/gateway.ts`): `RazorpayGateway` (official SDK, server-side keys)
  and `MockGateway` (offline simulator that signs payloads exactly like Razorpay; refused in production).
- `payments.ts`: start/resume payment (reuses gateway order), checkout-callback verification (HMAC signature +
  server-side payment fetch + amount/currency check), webhook processing (raw-body HMAC, `x-razorpay-event-id`
  idempotency via unique `PaymentEvent.eventId`, retry of failed events), row-locked capture handling,
  failure handling that never downgrades captured payments, late-capture reinstate-or-refund, duplicate-payment
  refunds, reconciliation, stale-order expiry (opportunistic + `npm run jobs:reconcile`), refunds with
  concurrency-safe reservation, refund webhooks.
- Client: `usePayment` hook loads Checkout.js, verifies on the server, reports failures; mock modal in dev.
- APIs: `/api/payments/razorpay/verify`, `/api/payments/razorpay/failure`, `/api/webhooks/razorpay`,
  `/api/orders/:n/pay`, dev-only `/api/payments/mock/complete`.
- Tests: unit signature tests; integration 22 (success, tampered signature, duplicate/concurrent callbacks,
  failure + retry, resume, stranger access, webhook signature, duplicates, callback/webhook race, out-of-order
  failure, amount mismatch, unknown events, expiry, delayed capture reinstated / refunded when sold out,
  interrupted checkout recovery, partial/full/concurrent refunds, customer cancel auto-refund, refund webhooks).
- Browser-verified with the mock gateway: online payment → order CONFIRMED/PAID.
- **Limitation:** `api.razorpay.com` / `checkout.razorpay.com` are blocked in the build sandbox, so the real
  Razorpay test-mode round trip could not be executed here. Set `PAYMENT_GATEWAY=razorpay` with test keys locally
  to exercise it (README → Razorpay test setup).

## Phase 8 — Admin dashboard ✅

- Dashboard (7/30/90-day range): gross sales, net revenue (collected − refunds), orders + AOV, customers, awaiting
  payment, to fulfil, delivered, active products/low stock, daily sales bar chart with tooltip + table view,
  bestsellers, recent orders, low-stock list, "needs attention" banner. All figures are SQL over live data.
- Orders: filters (status/payment/method/attention/search), detail with items, totals, GST split, timeline,
  payments/refunds/gateway events, customer + addresses; actions: status transitions (state-machine
  enforced), shipments with carrier/AWB/link (manual tracking), cancel (auto-refund if paid online),
  partial/full refunds, Razorpay reconciliation, invoice generation, resolve attention.
- Customers: search/filter, profile with orders/addresses/sessions, disable/enable (revokes sessions).
- Coupons: fixed/percentage, min order, max discount, global and per-customer limits, schedule/expiry,
  active toggle; used coupons are deactivated instead of deleted.
- Inventory: stock table with low/out filters and adjustments, stock movement ledger with reason filter.
- Settings: store/contact/address, logo upload, shipping, GST, COD rules (fee, min/max, blocked PIN codes),
  minimum order, order/invoice prefixes, low-stock default.
- Audit log viewer and development email outbox.
- Demo history: `npm run db:seed` now creates ~45 orders through the real services (skip with `SEED_DEMO_ORDERS=false`).
- Tests: admin 11 (403/401 on every admin API, process→ship→deliver COD flow with emails/audit, invalid
  transitions, manual COD refund + filters, customer disable/enable incl. session revocation, admin cannot be
  disabled via customer API, coupon CRUD/validation/deactivation, settings validation incl. GSTIN, dashboard math).

## Phase 9 — Indian e-commerce features ✅

- INR formatting (`en-IN` grouping), Indian mobile normalisation/validation, PIN code validation, 36 states/UTs
  with GST state codes, GSTIN structure + checksum + state match.
- Configurable GST: enable/disable, inclusive/exclusive pricing, per-product rate + HSN, default rate,
  intra-state CGST+SGST vs inter-state IGST, charges taxed at highest line rate (documented for accountant review).
- Invoices: consecutive per financial year, ≤16 chars (`INV2627/00001`), immutable JSON snapshot, "Tax Invoice"
  vs "Invoice" when unregistered, printable page `/invoice/:orderNumber` for admins, owners and guests (token).
- Shipping: flat fee, free-shipping threshold, minimum order; COD eligibility (enable, fee, min/max, blocked PINs).
- Manual shipment tracking via `Shipment` records (extensible for courier APIs).

## Phase 10 — Security hardening ✅

- See `SECURITY_REVIEW.md` for the full control matrix, fixed findings, dependency audit and remaining risks.
- Fixed: per-page admin authorization (layouts don't re-run on client navigation), server-side password
  complexity hook, proxy-aware client IP for rate limits, 400 on bad payment signatures, duplicate-payment
  refund accounting, contact messages visible to staff.
- New tests: `tests/unit/security.test.ts`, `tests/integration/security.test.ts` (traversal, open redirect,
  password policy, body size limits, malformed JSON, missing Origin, error leakage). Total: 177 passing.

## Phase 11 — Testing & QA ✅

- Playwright suite (`tests/e2e`, 29 tests) against a **production build** with an isolated E2E database,
  reseeded on each run; mock payment gateway for offline payment flows. See `QA_REPORT.md`.
- Bug found and fixed: a group-level `loading.tsx` made missing products/categories/orders return HTTP 200
  (soft 404). Loading skeletons now only wrap listing pages; unknown slugs return real 404s.

## Phase 12 — Performance, SEO & accessibility ✅

- SEO: per-page metadata + canonical URLs, Open Graph (default generated image + product images), dynamic
  `sitemap.xml` (products, categories, pages, image entries), `robots.txt` (private areas disallowed),
  JSON-LD for Product, BreadcrumbList, Organization and WebSite SearchAction, semantic headings/landmarks.
- Accessibility: axe (WCAG 2.1 A/AA) scans of 11 key pages in CI-style E2E; fixed colour contrast of brand,
  success and destructive tokens, invalid ARIA on loading skeleton, invalid `<dl>` children; skip link,
  labelled controls, accessible Radix dialogs, visible focus rings, reduced-motion support.
- Performance: Server Components by default (client components only for interactivity), `next/image`
  (AVIF/WebP, responsive `sizes`, priority on above-the-fold), indexed queries + pagination, denormalised
  price/sales for sorting, no client-side data waterfalls, chart animation disabled.

## Phase 13 — Documentation & handover ✅

- `README.md`: overview, architecture, stack, Windows + Docker setup, environment variables, database
  (migrations, seed, test DBs), authentication/admin provisioning, Razorpay test setup (mock and real, webhook
  tunnel), commands, tests, troubleshooting, handover (completed/tested features, limitations, credentials,
  production tasks).
- `API_DOCUMENTATION.md`, `QA_REPORT.md`, `SECURITY_REVIEW.md`; `ARCHITECTURE.md`, `DATABASE_DESIGN.md` and
  `PROJECT_PLAN.md` updated to match the implementation.

## Final status

| Check                       | Result           |
| --------------------------- | ---------------- |
| Lint / typecheck            | ✅               |
| Unit / integration / E2E    | ✅ 77 / 100 / 29 |
| Production build            | ✅               |
| Known critical/high defects | none open        |

**Not yet verified outside the sandbox:** real Razorpay test-mode round trip, Docker Compose start-up on Windows.
**Not production-ready until:** the "Production deployment tasks" in README.md are completed.

## Re-theme — Shayvera Foods (post-handover)

- Business confirmed as **Shayvera Foods** (spices & masalas, dry fruits, nuts, roasted makhana). Brand copy,
  About page (client-supplied text verbatim), homepage, SEO metadata, Open Graph image, footer, search, policies
  updated; invented placeholder claims (founding story, "40+ makers", ratings) removed.
- New migration `food_product_info`: `Product.ingredients/shelfLife/storageInfo/countryOfOrigin/isVegetarian` and
  `StoreSettings.fssaiLicense` (14-digit, validated). Shown on product pages (Product information + veg mark),
  footer and invoices; editable in Admin → Products and Admin → Settings.
- Food-appropriate returns policy (no returns once opened; damaged/expired/incorrect items replaced within 48 h) —
  **needs business confirmation**.
- Demo catalog replaced: 6 food categories, 23 products with weight variants and food illustrations
  (placeholder prices/stock/tax codes). Seed no longer invents a business address or phone.
- `formatINR` now always shows two decimals for fractional rupees (`₹1,617.30`).
- Tests: 178 unit + integration, 29 E2E — all passing.
- **Awaiting from the business:** contact email/phone/WhatsApp, address + state + PIN, legal name, GSTIN (if
  registered), FSSAI licence number, real product list with prices/weights, social links, policy confirmation.

---

# v2 — Scalable platform specification (started 2026-11-06)

## v2 Phase 0 — Discovery & architecture ✅

- Inspected the v1 codebase (32 models, 20 services, 40 route handlers, 207 tests passing) and environment.
- Network: created the **Shayvera-ecommerce** cloud environment (approved) allowing `apiv2.shiprocket.in`,
  `apidocs.shiprocket.in`, `api.razorpay.com`, `checkout.razorpay.com`, `razorpay.com`, `shayvera.in`.
- Read current official docs: Shiprocket Postman collection (endpoints, payloads, status code table, webhook
  spec: `x-api-key` token, URL keyword restrictions, timestamp format, **no sandbox**); Razorpay webhook docs
  (raw-body HMAC, `x-razorpay-event-id`, at-least-once, out-of-order, **5 s response**, 24 h retries,
  old-secret validation after rotation).
- Found the business's live WooCommerce catalog (10 products, real descriptions/photos; all prices shown as
  ₹64.98, treated as placeholders).
- Wrote: `PROJECT_PLAN.md` (gap analysis + 16-phase roadmap), `ARCHITECTURE.md` v2 (modules, platform layer,
  decisions D1–D10, lifecycles, cancellation/return rules), `DATABASE_DESIGN.md` v2 additions,
  `PAYMENT_INTEGRATION.md`, `SHIPPING_INTEGRATION.md`.

## v2 Phase 1 — Foundation: modules + platform layer ✅

- **Restructure**: `src/server/services|queries|payments|…` → `src/server/modules/<domain>/` and
  `src/server/platform/` (db, logger, rate-limit, sequence, storage). Behaviour unchanged; all tests green after the move.
- **Request context** (`platform/context.ts`): AsyncLocalStorage correlation id per request/job. `route()` accepts a
  safe incoming `X-Request-Id` or generates one, returns it as a response header, and 500 responses include
  `{ reference }` so support can find the log line.
- **Logger**: adds `requestId`/`jobId` to every entry; redacts secrets (password, token, signature, authorization,
  cookie, card, cvv, api key) and masks email/phone. **Monitoring hook** (`platform/monitoring.ts`) for a future
  error-reporting service; integration failures are tagged by provider/operation.
- **Job queue** (`platform/jobs`): `Job` table, enqueue inside transactions (outbox) with `dedupeKey`,
  `FOR UPDATE SKIP LOCKED` claiming, exponential backoff with full jitter, DEAD after `maxAttempts`, permanent
  errors, stuck-lock recovery, operator retry, pruning, queue stats. Periodic jobs are deduplicated per time window
  so several workers schedule each run once. Worker heartbeat in `SystemState`.
- **Worker**: `npm run worker` (graceful SIGINT/SIGTERM); in development the Next.js server runs the same loop
  in-process via `src/instrumentation.ts` (`JOB_RUNNER=inline|worker|off`).
- **Notifications**: `Notification` + `NotificationLog`. Order emails (confirmed, cancelled, shipped, delivered,
  refunded) are now queued **inside the transaction that changes the order** (`transitionOrder`, refunds, late-payment
  reinstatement) instead of fire-and-forget calls, rendered at delivery time, retried, and logged per attempt.
  Email provider interface with the dev-outbox implementation (no real email provider is configured).
- **Request-path sweep removed**: unpaid-order expiry is now the scheduled `payments.expire-unpaid` job (every 2 min);
  `maintenance.cleanup` (hourly) prunes old jobs and expired sessions/verification tokens/rate-limit buckets.
- **HTTP client** (`platform/http.ts`): timeouts, retries only for idempotent calls (408/429/5xx/network,
  Retry-After), correlation header, no body/header logging. **Cache** (`platform/cache.ts`): interface + bounded
  in-process TTL cache for public data only.
- **Health** `/api/health`: DB latency, queue backlog/oldest due job, dead jobs, worker heartbeat; 503 only when the
  DB is down, `degraded` otherwise. Boot now fails fast on invalid environment configuration (instrumentation loads
  the validated env).
- **Docker**: multi-stage `Dockerfile` (`web` standalone + `worker`), `.dockerignore`, `docker-compose.prod.yml`
  (db, migrate, web, worker). `NEXT_OUTPUT=standalone` build **verified locally** (standalone server served pages,
  health and the inline runner). **Image build not verified**: no Docker daemon in the build sandbox.
- **Tests**: +14 integration (enqueue/dedupe, transactional rollback, runAt, 4-worker concurrent claim with no
  duplicates, retry/backoff, dead-letter + operator retry, permanent errors, crashed-worker recovery, stale worker
  cannot complete, schedule dedupe, heartbeat, notification delivery/dedupe/failure logging, health) and +11 unit
  (backoff, cache TTL/eviction, HTTP retry/timeout/non-JSON/correlation, log redaction, context isolation).
  Existing email assertions now drain the queue explicitly instead of polling.

## v2 Phase 2 — Admin roles, permissions and staff management ✅

- **Schema** (`admin_roles` migration, additive): `AdminPermission` enum (18 values), `AdminRole`
  (`permissions[]`, `isSystem`), `User.adminRoleId` (FK `SET NULL`). The migration seeds the five built-in roles
  (Owner, Operations, Catalog, Support, Accounts) and gives **existing administrators the Owner role**, so nobody
  loses access on upgrade.
- **Enforcement**: `adminRoute(permission, handler)` on all 37 admin handlers and `requireAdminPage(permission)` on
  every admin page; permissions are loaded from the database per request (role edits apply on the next request);
  admins without a role fail closed; the Owner role always resolves to every permission. Cancelling a paid online
  order additionally requires `PAYMENTS_REFUND` (it refunds automatically). Staff who open a page outside their role
  are redirected to `/admin/no-access`, which lists the sections they can use (`forbidden()` is still experimental in
  this Next.js version, so it was not used).
- **UI**: admin navigation and order actions hide what the role cannot do (server remains authoritative).
- **Staff & roles page** (`/admin/staff`, `ADMINS_MANAGE`): invite by email (set-password link via the Better Auth
  reset flow with invite wording; an existing customer account is promoted, signed out and notified), resend invite,
  change role, disable/enable (revokes sessions), remove staff access (account kept as a customer). Custom roles with a
  grouped permission picker; built-in roles keep their names, the Owner role is fixed, roles in use cannot be deleted.
  Guards: no self-edits; the last active Owner cannot be demoted, disabled or removed — serialised with a Postgres
  advisory lock so two owners demoting each other at once cannot both succeed. All changes audit-logged.
- `npm run admin:create` now always creates an **Owner** (bootstrap); seeds and test resets ensure built-in roles.
- **Tests**: +13 integration (`rbac.test.ts`: built-in roles match the migration; Owner always full; **sweep of every
  admin route handler → 401 anonymous / 403 role-less**; per-role scoping; live role edits; paid-cancel needs refund
  permission; invite → set password → scoped access; promotion signs out + notifies; self-edit / last-Owner guards;
  concurrent mutual demotion; disable/remove; role protections and validation) and +1 E2E (owner invites a Catalog
  staff member through the UI; the invitee sets a password, sees only catalog sections and is redirected from Orders).
- Results: unit 88 · integration 129 · E2E 30 — all passing; lint, typecheck, build clean.

## v2 Phase 3 — Storefront additions ✅

- **Wishlist** (`WishlistItem`, migration `wishlist`): signed-in customers save products (idempotent, products on sale
  only, max 200, rate limited). Heart buttons on product cards and the product page share one client store seeded by
  the store layout (no extra request); guests are sent to sign in and come back. `/account/wishlist` lists saved
  products with live prices/stock; products taken off sale stay listed as "No longer available". Links in the account
  nav and user menu.
- **Buy now**: product page button → `/checkout?buy=<variant>&qty=<n>`. The same server pricing, stock checks, coupon
  rules and transactional order creation as a cart checkout, for a single transient line; the cart (items and saved
  coupon) is never read or emptied. Coupons for a Buy-now order are entered at checkout. Unavailable/over-stock
  requests return to the product page with a notice.
- **Specifications**: product page "Specifications" table built by `productSpecifications()` from structured fields
  (brand, category, net quantity, ingredients, shelf life, storage, food type, origin, FSSAI, marketed by) — Phase 4
  adds attributes and package details to the same function.
- **Order tracking**: public `/track` (order number + email or mobile in any format) → read-only tracking page with a
  status timeline, shipment/courier link and items; it shows no address, contact, payment details or actions (separate
  HMAC token purpose; the full guest token still comes only from the confirmation email). Footer "Track an order"
  now points here. Customer order pages show the same **status timeline** (status + time only, never staff notes).
- **Invoices**: account order history links each issued invoice.
- **Deferred to Phase 7 (by design)**: the customer cancellation-request and return-request screens depend on the
  request model and the new order statuses introduced there; building them now would mean UI without a backend.
- **Tests**: +11 integration (`storefront.test.ts`: wishlist isolation/idempotency/auth/availability; Buy now leaves
  cart + coupon intact and moves only that stock, coupon at checkout, stock/unknown/limit errors, server preview;
  tracking by email/phone formats, uniform errors, read-only token exposes no personal data and cannot open the full
  order), +2 unit (specifications), +5 E2E (wishlist sign-in redirect/save/remove, Buy now with cart unchanged,
  tracking without address, specifications table, protected wishlist page).
- Results: unit 89 · integration 141 · E2E 35 — all passing; lint, typecheck clean.

## v2 Phase 4 — Catalog: specifications, packages, WooCommerce import ✅

- **Schema** (migration `catalog_attributes_packages`, additive): `ProductAttribute` (ordered name/value rows),
  `ProductVariant.lengthMm/breadthMm/heightMm` (with existing `weightGrams`), store default package
  (`defaultPackageWeightGrams/LengthMm/BreadthMm/HeightMm`), `Product.sourceRef` (unique). Database CHECK constraints
  reject non-positive package values. (Generated with `prisma migrate diff` and applied with `migrate deploy`, because
  `migrate dev` refused to run non-interactively; no data was reset.)
- **Admin**: product form "Specifications" editor (add/reorder/remove, server-validated: ≤30 rows, unique names);
  variant dialog "Shipping package" (packed weight + box, all-or-none); Settings → "Default package". Settings API keeps
  these optional so older clients are unaffected.
- **Storefront**: the specifications table now includes the product's own rows after brand/category/net quantity; a
  custom row named like a built-in one replaces it.
- **Shipping groundwork**: `computeShipmentPackage()` parcel estimate, courier unit conversion and volumetric weight
  (used by Shiprocket in Phase 9).
- **WooCommerce importer** (`npm run catalog:import-woo`): Store API (no credentials), pagination, variable products
  (variation details fetched), HTML → plain text (entities decoded, scripts/markup dropped), prices from minor units,
  attributes, categories (map option, match by slug/name, otherwise created **hidden**), images downloaded **only over
  HTTPS from the source host** (no redirects, 10 MB cap) and passed through the admin upload validation/re-encode.
  Products land as **DRAFT with zero stock**; idempotent via `sourceRef`; published products are never overwritten;
  drafts refresh only with `--update-drafts`; slug/SKU clashes get suffixes; uniform prices are flagged as likely
  placeholders; every import is audit-logged. Dry run by default.
- **Verified against the live site** (sandbox database only): dry run mapped all 10 shayvera.in products; `--apply`
  created 10 drafts with 17 real images re-encoded to WebP, the "Dry Fruits & Nuts" category hidden, stock 0, and
  flagged the ₹64.98 placeholder price; a second run skipped all 10. Nothing was imported into any business database.
- **Tests**: +11 unit (parcel estimate/units, HTML-to-text/entities/truncation, attribute rows in specifications),
  +14 integration (importer: mapping, minor units, non-INR skip, dry run writes nothing, drafts/zero stock/variants/
  attributes/hidden category/audit, image host and HTTPS enforcement, idempotency, draft refresh, published never
  overwritten, slug/SKU clash, category map, placeholder flag, https-only source; admin API: attributes create/replace/
  keep, validation, package clear, DB CHECK constraints, default package settings), +1 E2E (admin adds a specification
  and variant package; storefront shows the row).
- Results: unit 100 · integration 155 · E2E 36 — all passing; lint, typecheck, build clean.

## v2 Phase 5 — Inventory reservations ✅

- **Model** (migration `inventory_reservations`): `Inventory.quantityReserved`, `InventoryReservation`
  (`ACTIVE → CONSUMED | RELEASED`, `expiresAt` for unpaid online orders), ledger reason `ORDER_FULFILLED`.
  Database CHECKs: `0 ≤ reserved ≤ onHand`, reservation quantity > 0. **Available = on hand − reserved.**
- **Lifecycle**: checkout **reserves** (conditional single-row update on available stock — concurrent orders cannot
  oversell; the hold expires with the payment window for online orders); payment confirmation removes the expiry;
  entering `SHIPPED` **deducts** (on hand and reserved both drop, ledger `ORDER_FULFILLED`) — Phase 7 moves this to
  `READY_TO_SHIP`; cancellation or payment expiry **releases** (reserved drops; on hand and ledger untouched).
  Settling claims each reservation with a conditional status update, so repeats/concurrency never double-count; a
  released hold can never be consumed. Late-payment reinstatement re-reserves (non-expiring).
- **Existing data**: the migration converted open orders (pending/confirmed/processing) into ACTIVE reservations and
  put their units back on hand with a `CORRECTION` ledger entry each, so available stock is unchanged (verified on the
  dev data: 2,445 available before and after; 6 units now held by 4 reservations). Cancelling an order that somehow has
  no reservations falls back to the old restock, so nothing is lost.
- **Everywhere stock is read** (cart limits, storefront in-stock/sold-out and the in-stock filter, product page,
  admin product list, low-stock dashboard card, admin "out of stock" filter) now uses available stock. Admin stock
  removals cannot go below reserved units. Admin inventory shows **On hand / Reserved / Available**; the order page
  shows whether the order's stock is reserved, deducted or released.
- **Reconciliation** (`inventory.reconcile`, hourly): compares `quantityReserved` with ACTIVE reservations and counts
  holds whose payment window lapsed >30 min ago; stores the result in `SystemState` and logs a warning. **Report-only —
  stock is never changed automatically.** Drift is also shown as a banner on Admin → Inventory.
- **Tests**: +10 integration (`inventory.test.ts`: reserve→deduct→deliver with ledger; cancel releases without
  touching on-hand/ledger; idempotent settling; online hold expiry cleared on payment; concurrent cancel vs ship — one
  wins, stock consistent; legacy order restock; admins cannot remove reserved units; fully reserved products sold out
  and not addable to cart; DB CHECK; reconciliation reports without changing stock). Existing tests that asserted
  "on hand drops at placement" now assert available stock / reservation rows (the behaviour changed by design); the
  concurrent-oversell test passes unchanged in intent.
- Results: unit 100 · integration 165 · E2E 36 — all passing; lint, typecheck clean.

## v2 Phase 6 — Checkout delivery checks (serviceability) ✅

- **Shipping provider layer** (`modules/shipping`): internal `ShippingProvider` contract with `MockShippingProvider`
  (deterministic, offline), `ManualShippingProvider` (no checks) and `ShiprocketProvider` (auth + serviceability from
  the official API collection, re-read 2026-11-06: JWT valid 10 days cached and refreshed, shared login, re-login on
  401; documented query parameters and units). Selected by `SHIPPING_PROVIDER` (`mock` in development, `manual` in
  production by default; `mock` refused in production; `shiprocket` requires API-user credentials).
- **Checkout rules** (server-enforced, 3 s budget, 6 h cache of answers only): no courier → 422 on the PIN field and
  no order/stock hold; COD where couriers are prepaid-only → 422 on payment method (online payment still works);
  provider slow/down/unexpected → order placed and marked `deliveryCheck = UNVERIFIED` (admin warning + "Needs
  attention" list); manual shipping or no store PIN → `SKIPPED`. The courier estimate is stored on the order.
  Integration problems never block checkout: only a successful answer with zero couriers counts as "not serviceable".
- **Checkout page**: live delivery note as the PIN is typed (estimate / COD unavailable / not deliverable), COD option
  and Place-order button follow it; courier rates are never sent to the browser.
- **Admin**: order page shows the courier estimate or an "unverified coverage" warning; "Needs attention" filter now
  includes open unverified orders (filters combined with AND — fixed a latent case where search would have replaced
  the attention filter).
- **Read-only verification script** `npm run shipping:verify` for when real credentials exist (creates nothing).
- **Verification status**: Shiprocket auth/serviceability **implemented and tested against the official example
  payload with an HTTP-level fake — not verified against the real API (no credentials; Shiprocket has no sandbox).**
- **Tests**: +7 unit (official-example parsing, blocked couriers, empty list, unexpected shapes rejected, documented
  query/units, token reuse, 401 re-login with a single shared login, login failure without leaking the password, mock
  rules), +7 integration (estimate stored, unserved PIN blocked without order/hold, COD refused but prepaid allowed,
  provider down → UNVERIFIED + attention list, slow provider times out fast, answers cached and failures not, manual /
  no-store-PIN skipped, endpoint answers for cart and Buy now without rates, PIN validation), +1 E2E (estimate, COD
  disabled, unserved PIN blocks ordering, order records the check).
- Results: unit 107 · integration 172 · E2E 37 — all passing; lint, typecheck clean.

## v2 Phase 7 — Order lifecycle, cancellation & return requests ✅

- **14 order statuses** (migration `order_lifecycle_requests`, enum values added in place): `PENDING` (pending payment),
  `PAYMENT_FAILED`, `CONFIRMED`, `PROCESSING`, `READY_TO_SHIP`, `SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERED`,
  `CANCELLATION_REQUESTED`, `CANCELLED`, `RETURN_REQUESTED`, `RETURNED`, `REFUND_PENDING`, `REFUNDED`. One transition table
  plus shared groups (awaiting payment, before handover, sold, invoiceable, request-driven), labels, badge tones and
  progress mapping in `order-status.ts`; every caller (dashboard, invoices, customers, filters, badges) uses them.
  Payment, shipment and refund states remain separate records.
- **Payments**: a verified failed attempt moves `PENDING → PAYMENT_FAILED`; the order stays payable (stock held) until
  the window lapses; a later capture confirms it; expiry cancels both states.
- **Stock**: deduction now happens at `READY_TO_SHIP` (idempotent at `SHIPPED`); cancelling a packed-but-unshipped
  order puts the units back (ledger `ORDER_CANCELLED`); returns restock only the quantities staff enter on receipt
  (ledger `RETURN`).
- **Refunds**: a full refund of a cancelled/returned/delivered order goes `REFUND_PENDING → REFUNDED` on settlement; a
  failed refund keeps `REFUND_PENDING` and flags the order for attention.
- **Requests** (`OrderRequest`, one open per order via a partial unique index): customers request cancellation of
  accepted orders before handover (unpaid orders still cancel instantly) or a return of delivered items within the
  return window (Settings → "Return window after delivery", default 2 days, matching the existing 48-hour policy) and can
  withdraw pending requests. Staff approve/reject with notes (customer emailed), and record received returns with
  per-line restock. Approving a paid online cancellation needs refund permission; restocking needs inventory permission;
  staff status changes are blocked while a request is open. Every decision is audit-logged and compare-and-set.
- **Side-effect guard**: returning to an earlier status (request rejected/withdrawn, failed delivery attempt) does not
  repeat first-time effects (emails, sales counts, timestamps — so a rejected return never resets the return window).
  Transition emails are deduplicated per transition event.
- **UI**: customer order page — progress (Confirmed / Packed / Shipped / Delivered), request banners, "Request
  cancellation", "Request a return" (item + quantity picker), "Withdraw request"; admin — "Cancellations & returns" queue
  (`/admin/requests`), request panel on the order page (approve / approve & refund / reject / mark received with
  restock), new statuses in filters, status menu and badges. New emails: out for delivery, cancellation requested, return
  requested / approved / received, request rejected.
- **Bugs caught by the new tests and fixed**: the side-effect guard initially also suppressed the emails for approved
  cancellations and received returns.
- **Deferred to Phase 9 (by design)**: cancelling a courier shipment automatically when a cancellation is approved (for
  now staff get a "cancel it with the courier" reminder when a shipment record exists), and RTO detection from courier
  events.
- **Tests**: +27 unit (all statuses labelled/toned, 23 new allowed/forbidden transition cases, every status reachable,
  groups), +11 integration (`order-lifecycle.test.ts`: READY_TO_SHIP deduction and email counts across a failed delivery
  attempt; immediate vs requested cancellation; packed-order cancellation restock; reject without repeated effects and
  double-decision refusal; withdraw; concurrent requests → one; no cancellation after handover; staff status change
  blocked; support cannot approve paid cancellation; full return → partial restock → refund chain with emails; rejected
  return keeps delivery time; return window and restock permission; PAYMENT_FAILED expiry; approved cancellation email),
  +2 E2E (staff approve a cancellation from the queue; customer return → approve → receive without restock). Existing
  tests updated where behaviour changed by design (failed payment status, cancellation now via approval, per-event email
  dedupe).
- Results: unit 134 · integration 183 · E2E 39 — all passing; lint, typecheck, build clean.

## v2 Phase 8 — Razorpay hardening ✅

- **Fast-acknowledged webhooks**: `/api/webhooks/razorpay` verifies the signature, stores the event and enqueues a
  `payments.webhook` job in one transaction, then answers 200 — processing (including any gateway calls) no longer runs
  inside Razorpay's 5-second window. Concurrent duplicate deliveries store one event and one job; a redelivered event
  whose job died is revived; staff can retry unprocessed events from Admin → Payments (audit-logged). Malformed or
  unsigned payloads store nothing.
- **Secret rotation**: `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` is accepted alongside the current secret.
- **No double refunds**: gateway errors are classified as definite (4xx except 408/429 → refund failed, amount
  released, reason shown to staff) or unknown (timeout/network/5xx/429 → refund stays `PENDING`, amount stays reserved,
  reconciled against Razorpay's refund list by `notes.refundId`; released only if Razorpay has no such refund after 10
  minutes). Duplicate-payment refunds check Razorpay's existing refunds before issuing one.
- **Capture follow-ups as jobs**: reinstating an expired order or refunding an unfulfillable/duplicate capture is
  enqueued inside the transaction that detects it (never lost, retried on failure).
- **Scheduled reconciliation** (`payments.reconcile`, every 15 min): unconfirmed online attempts older than 10 minutes
  (lost callback + missed webhook) and refunds pending for more than 15 minutes.
- **Payments dashboard** (`/admin/payments`, `PAYMENTS_VIEW`): captured today / 7 days, failed attempts, refunds in
  progress and refunded in 30 days, webhooks not processed (with Retry), refunds needing a look, recent payments with
  status/method/search filters.
- **Verification status**: everything above is tested with the mock gateway and a failure-injecting gateway; a real
  Razorpay **test-mode** round trip is still unverified (needs `rzp_test_` keys).
- **Tests**: +10 integration (`payments-hardening.test.ts`: fast ack then worker apply; concurrent duplicates; dead job
  revived by redelivery and by staff retry, second retry refused; bad signature/malformed store nothing; rotation;
  timeout after Razorpay created the refund → settled from Razorpay, no second refund, no second refund can slip in;
  timeout before creation → released only after grace, then refundable; definite rejection → 502 + released;
  duplicate-refund job re-run refunds once; lost callback + webhook confirmed by reconciliation), +1 E2E (payments
  dashboard). Existing webhook tests deliver then run the queue as the worker would; the E2E server runs the job loop.
- Results: unit 134 · integration 193 · E2E 40 — all passing; lint, typecheck clean.

## v2 Phase 9 — Shiprocket shipment module ✅ (mock-verified; live API unverified)

- **Provider contract** `ShipmentOperations` (create, find by reference, AWB, pickup, label, manifest, track, cancel,
  return, tracking URL) implemented by `ShiprocketShipments` (official collection endpoints) and an in-memory mock.
- **Schema**: 18 shipment statuses, extended `Shipment`, `ShipmentEvent`, `PickupLocation`, `WebhookEvent`; one active
  courier shipment per order enforced by a partial unique index (migrations `shipping_module`, `shipping_active_guard`).
- **Workflows**: queued idempotent booking (search-before-recreate, 422 duplicate → lookup, definite vs unknown
  errors, retry), pickup + manifest, on-demand label/manifest, cancel before pickup, automatic courier cancellation
  when an order is cancelled, reverse pickup for approved returns, webhook (token, dedupe, fast ack, stale/terminal
  protection, unknown AWB/code handling) and 30-minute tracking sync. Shipment status drives order status
  (READY_TO_SHIP → SHIPPED → OUT_FOR_DELIVERY → DELIVERED with COD paid; RTO → RETURNED).
- **Admin**: Shipping panel on orders, return pickup button, pickup location in Settings, `/admin/shipments`
  dashboard + nav link. **Customer**: shipment status, ETD and scan history on order and tracking pages.
- **Behaviour change**: `shipmentToCancel` on an approved cancellation now flags only manual shipment records
  (courier bookings are cancelled by the system). Return pickups and cancelled bookings no longer appear in the
  customer's view or the "shipped" email.
- **Verification status**: implemented from the official Shiprocket collection; adapter parsing unit-tested against
  documented payloads; workflows integration- and E2E-tested with the mock courier. **No real Shiprocket call has been
  made** (no sandbox exists; awaiting the business's API user and pickup address).
- **Tests**: +24 unit (`shipping.test.ts`: body building, response parsing, IST timestamps, status normalisation,
  order mapping), +17 integration (`shipping.test.ts`), +1 E2E (`shipping.spec.ts`: pickup location → book → AWB →
  pickup → webhook → customer sees "Out for delivery"; wrong token 401). The admin route sweep covers the new routes.
- Results: unit 158 · integration 210 · E2E 41 — all passing; lint, typecheck, production build clean.

## v2 Phase 10 — Admin dashboards and reports ✅

- **Reports** (`/admin/reports`, `REPORTS_VIEW`): any period up to 366 days in India-time days (presets: 7/30 days,
  this/last month, financial year from 1 April). Gross sales, net of refunds, AOV, tax (CGST/SGST/IGST), discounts,
  shipping and COD fees, cancellation and return rates, daily chart, orders by status, payment methods, products,
  categories, coupons, sales by state, and a **GST register** built from issued invoices' immutable snapshots (by
  invoice date) with an HSN summary — labelled for the accountant's review, not as a filing.
- **CSV exports** (daily, products, categories, states, coupons, GST register, HSN): exact rupee amounts from integer
  paise, UTF-8 BOM, formula-injection protection (cells starting with `= + - @` are prefixed), audit-logged.
- **Invoices** (`/admin/invoices`): searchable, by financial year, with delivered orders still lacking an invoice.
- **Dashboard**: "Needs attention" panel limited to the viewer's permissions — orders flagged, Razorpay webhooks not
  processed, refunds pending/failed, shipment failures, requests to decide, approved returns awaiting the parcel, dead
  jobs, delivered orders without an invoice; new Cancelled and Open requests tiles.
- **Background jobs** (`/admin/jobs`, `JOBS_MANAGE`): worker heartbeat, waiting/overdue, done in 24 h, dead; failing
  job types; failed/dead list (payloads never shown) with an audit-logged Retry.
- **Existing dashboards completed**: Shipments — stage counts (booking, failed, AWB, pickup, in transit, out for
  delivery, delivery failed, delivered, RTO, lost/damaged) and open return pickups; Cancellations & returns — open
  counts, awaiting receipt, median decision time, refunds in 30 days; Staff — active/pending/disabled, actions per
  person and per area from the audit log. Navigation gains Invoices, Reports and Background jobs.
- **Bug fixed**: the dashboard's daily chart bucketed orders with `"placedAt" AT TIME ZONE 'Asia/Kolkata'`, but Prisma
  stores UTC in `timestamp without time zone`, so orders placed between 00:00 and 05:30 IST were counted on the
  previous day. Both queries now convert UTC → IST first; regression-tested.
- **Tests**: +3 unit (`csv.test.ts`), +11 integration (`reports.test.ts`: IST period boundaries, 366-day cap and
  fallbacks, sales maths incl. state tax split/refunds/coupons, empty period, GST register vs invoice snapshot, CSV
  amounts and formula escaping, export route permission/audit/400, alerts filtered by permission, job retry + 409,
  invoices list/uninvoiced, request figures, dashboard midnight bucketing), +2 E2E (`reports.spec.ts`) and axe scans
  of the new/updated admin pages. New admin routes are covered by the RBAC sweep.
- Results: unit 161 · integration 221 · E2E 44 — all passing; lint, typecheck, production build clean.

## v2 Phase 11 — Returns, refunds, credit notes and notifications ✅

- **Return → refund**: after staff record what came back, "Refund return" proposes the value of the received units at
  the price paid (line total incl. tax, after discounts, per unit); shipping and COD fees can be added; staff may refund
  less (deduction after inspection), never more. The refund is linked to the return request; one live refund per return
  is enforced by a row lock plus a partial unique index (concurrent clicks → 201 + 409). Online payments refund through
  Razorpay with the Phase 8 safeguards; COD refunds are recorded as manual. No automatic refunds or restocking were added.
- **Credit notes** (`CreditNote`): issued automatically, in the same transaction that marks a refund processed, when the
  order has an invoice (one per refund, numbered `CN<FY>/00001` per financial year, prefix in Settings). Tax heads are
  pro-rated from the invoice and the taxable value takes the remainder, so parts always add up. Immutable snapshot,
  printable page `/credit-note/:id` (invoice access rule), listed on the order (admin and customer), on Admin → Invoices,
  and netted in the GST register with its own CSV.
- **Staff alerts** (`alertEmails` in Settings, ≤ 5): new order, cancellation/return requested, refund failed, courier
  booking failed / unknown status / lost-damaged-RTO, and a once-a-day low-stock digest. Queued in the business
  transaction (outbox), deduplicated per event and recipient, rendered at send time, no customer contact details.
- **Customer notifications**: all order emails now use a branded layout with the store's support contact; delivered,
  returned and refunded emails link the invoice when one exists; refund email amounts use exact integer formatting
  (previously floating point).
- **Invoices**: optional automatic issue on delivery (`invoices.issue` job, idempotent, re-checks the order status).
- **Customer refund tracking**: the order page lists each refund (amount, processing/refunded/not completed, date, where
  the money goes, Razorpay reference) with its credit note.
- **Tests**: +11 integration (`returns-notifications.test.ts`: credit-note maths, quote/limits/refund/credit note/GST net,
  concurrent refunds of one return, refusal before receipt and no credit note without invoice, PAYMENTS_REFUND required,
  staff alerts per recipient + dedupe + no PII + branded customer email, alerts off when unset, return-request and
  failed-refund alerts, daily low-stock digest, settings validation, auto-invoice on/off); return E2E extended through
  invoice → refund → customer sees refund and opens the credit note.
- Results: unit 161 · integration 232 · E2E 44 — all passing; lint, typecheck, production build clean.

## v2 Phase 12 — Security hardening and reliability review ✅

Full re-review against the specification's security (§14) and reliability (§15) lists; results in
`SECURITY_REVIEW.md` §2a, §3 and §5.

- **Fixed**: login CSRF on Better Auth sign-in/sign-up (origin check added in front of every auth POST); open
  redirect via tab/newline in the post-login `next` path (URL-parser-based check); non-idempotent stock
  adjustments (required idempotency key stored uniquely on the ledger; retries and concurrent duplicates apply
  once; both admin dialogs send it); Razorpay SDK calls without timeout (bounded, unknown outcome → reconcile);
  missing rate limits on payment start, failure reports, request withdrawal, cart writes, address/profile updates;
  branding upload size check before parsing + rate limit; API `Cache-Control: private, no-store` default;
  `server-only` on every module that reads secrets; `Cross-Origin-Opener-Policy`.
- **Dependencies**: `deepmerge-ts` advisory (Prisma CLI) resolved with a pinned override → production audit
  clean; dev-only `minimatch` advisory accepted (the suggested fix downgrades `eslint-config-next`).
- **Automated sweeps** (`security-sweeps.test.ts`): all 69 mutating API handlers reject cross-origin and
  origin-less requests; Better Auth rejects untrusted origins; every admin page names its permission; client
  components import server code as types only and read no private env; secret-reading modules are server-only;
  no unsafe raw SQL; API responses not cacheable; payment-start rate limit; idempotent stock adjustments.
- **Migration**: `inventory_idempotency` (nullable unique `InventoryTransaction.idempotencyKey`; additive).
- **API change**: `POST /api/admin/variants/:id/stock` now requires `idempotencyKey` (UUID); response may include
  `replayed: true`.
- Results: unit 167 · integration 241 · E2E 44 — all passing; lint, typecheck, production build clean.

## v2 Phase 13 — Performance, SEO, accessibility and observability ✅

- **Database performance**: added indexes for every dashboard/report access path that lacked one
  (`Order.placedAt`, `Shipment(status, updatedAt)`, `Refund(status, createdAt)` and `processedAt`,
  `Payment(status, capturedAt)`, `Invoice.issuedAt`) and partial indexes for the work queues (orders/shipments
  needing attention, unprocessed payment webhooks) — migration `performance_indexes`, additive.
- **`npm run perf:check`**: seeds a year of synthetic data into a _separate_ database (`PERF_DATABASE_URL`;
  refuses the app database) and times 14 dashboard, report, list and storefront queries against a budget.
  Found and fixed one scaling problem: the GST register summed invoice snapshots in JavaScript (2.2 s for a year at
  200k orders) — now aggregated in SQL (66 ms); rows load only for CSV exports. Results:

  | Query (median)           | 20k orders   | 200k orders  |
  | ------------------------ | ------------ | ------------ |
  | Dashboard figures (90 d) | 19 ms        | 104 ms       |
  | Dashboard alerts         | 7 ms         | 66 ms        |
  | Sales report (365 d)     | 42 ms        | 455 ms       |
  | GST register (365 d)     | 140 ms → SQL | 66 ms        |
  | Orders list (page 1/500) | 28 / 40 ms   | 313 / 327 ms |
  | Shipments / Payments     | 12 / 9 ms    | 51 / 36 ms   |
  | Shop listing             | 3 ms         | 3 ms         |

- **Front-end weight**: E2E performance budgets on the production build (compressed JS ≤ 250 KB per storefront
  page, TTFB ≤ 1.5 s; measured 226–241 KB, TTFB 9–21 ms). The auth client is now loaded only when signing out
  (−13 KB on every storefront page). Images already use `next/image`; search suggestions are debounced.
- **SEO**: `robots.txt` also disallows `/credit-note/` and `/track/` (token pages); product structured-data prices
  use exact integer formatting. Existing: dynamic metadata, Open Graph, canonical URLs, Product/Breadcrumb/
  Organization JSON-LD, live sitemap without drafts, noindex on private pages.
- **Accessibility**: axe now fails on moderate as well as serious/critical violations and covers 15 public pages
  (incl. 404), cart/checkout with validation errors, all account pages, the open account menu and 18 admin pages.
  Fixed: unlabeled currency field (critical); account menu hid the page from screen readers while focusable and had
  a low-contrast line (serious); announcement bar outside landmarks; heading order on listing, product, account
  and admin pages; empty cart without a page heading; 404 page without a main landmark; duplicate product links
  (each product is now one tab stop and its name is read once). New keyboard tests: skip link, visible focus,
  dialog focus trap/Escape/focus return, add to cart by keyboard.
- **Observability**: `onRequestError` for page/action/proxy errors; configurable `MONITORING_WEBHOOK_URL` reporter
  (redacted, rate-limited, web + worker); slow API request warnings (`SLOW_REQUEST_MS`); webhooks now run inside
  the request context; **System status** table on Admin → Background jobs (modes and timestamps only, never secret
  values — tested).
- **Tests**: +2 unit (timeout earlier, webhook reporter), +1 integration (system status reveals no secrets),
  +6 E2E performance budgets, +12 accessibility/keyboard tests (E2E 59 total).
- Results: unit 168 · integration 242 · E2E 59 — all passing; lint, typecheck, production build clean.

## v2 Phase 14 — Test consolidation and QA ✅

- **Traceability**: every item of the specification's testing strategy (unit, integration, mocked provider
  scenarios, customer and admin E2E flows, concurrency) is mapped to concrete tests in `QA_REPORT.md` §2.
- **Gaps closed**: unit tests for inventory availability, the courier webhook dedupe key (extracted as a pure
  function) and the real Razorpay adapter with a fake SDK (mapping; 4xx/408/429/5xx/network/timeout
  classification); Shiprocket workflow tests for service unavailability (503) and an unreadable success response;
  exact-count tests for the Payments and Shipments dashboards; a mobile COD checkout E2E.
- **Concurrency suite** (`concurrency.test.ts`): checkouts racing staff adjustments, 20 parallel adjustments (no
  lost update), removals racing reservations, cancel-vs-pack conflict, five simultaneous courier webhook
  deliveries — all asserting stock/ledger/reservation invariants.
- **Defect fixed**: a Shiprocket create-order success response without ids was classified as a definite refusal
  (booking failed, staff asked to fix it); it is now an unknown outcome retried with a lookup by reference.
- **Coverage**: `npm run test:coverage` (`@vitest/coverage-v8` 4.1.12, pinned to Vitest) — lines 84.6 %,
  statements 82.0 %, functions 82.8 %, branches 72.4 %, with enforced floors.
- **Stability**: unit + integration run three times and E2E twice, all green, no retries.
- Results: unit 181 · integration 251 · E2E 60 — all passing; lint, typecheck, production build clean.

## v2 Phase 15 — Final review and production readiness ✅

- **Two production blockers found and fixed:**
  - **Storage depended on the local disk** (spec: production must not). Added an S3-compatible provider
    (`STORAGE_DRIVER=s3`: AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO) with SigV4 signing implemented in-house
    and verified against the official AWS test vectors; image URLs (`/media/<key>`) are unchanged.
  - **Email was a development outbox only** — order emails and password resets could never be delivered. Added an
    SMTP provider (`EMAIL_PROVIDER=smtp`, `nodemailer` 10.2.1 pinned, TLS required), tested against a local fake
    SMTP server.
- **Backups**: `scripts/ops/db-backup.sh` (pg_dump + checksum + retention) and `db-restore.sh` (refuses non-empty
  targets); restore drill run locally — counts and migration history matched.
- **Deployment examples**: `deploy/Caddyfile.example` (HTTPS reverse proxy), production compose notes for storage,
  email and backups. Not applied anywhere (no hosting yet, by design).
- **System status** now includes storage and the real email mode; warns in production for local storage or the
  dev outbox.
- **Final review fixes**: intermittent axe failure traced to loading skeletons without a page heading (fixed);
  docs consistency sweep (all API routes documented, all models in DATABASE_DESIGN, env vars in `.env.example`);
  README environment, tests and handover sections rewritten for v2.
- **`PRODUCTION_READINESS.md`**: verdict (development-complete, not launch-approved), acceptance-criteria matrix
  with evidence, configuration, deployment architecture, storage, backups/recovery, pooling and roles,
  monitoring/alerting plan, webhook requirements, pre-launch verifications and the launch review checklist.
- Results: unit 185 · integration 254 · E2E 60 (run twice) — all passing; coverage lines 84.6 %; lint,
  typecheck, production build clean; production `npm audit` 0 vulnerabilities.

## Mobile number + OTP sign-in ✅ (dev outbox verified; MSG91 live delivery unverified)

- **Customers sign in with their mobile number and a 6-digit SMS code** (Better Auth 1.7.13 `phone-number`
  plugin). The first verified code creates the account; new customers are asked for their name. Email + password
  stays available on a second tab; staff (admin) accounts can only use email + password — an SMS code never opens
  the admin, checked when the session is created.
- **Security:** Indian mobiles only (`+91[6-9]XXXXXXXXX`); codes expire in 5 minutes, 3 wrong attempts burn the
  code, codes are single-use; per-IP limits (3 sends / 10 verifies per minute) plus a per-number throttle (30 s
  between sends, 5 per hour) against SMS bombing; role/status in the verify body are ignored; numbers can only be
  attached by verifying a code (`update-user` cannot set one); phone + password and phone password-reset endpoints
  are disabled (404).
- **Accounts:** new column `user.phoneNumber` (unique) + `phoneNumberVerified`; phone-only accounts get a
  non-deliverable placeholder email (`<digits>@phone.invalid`) which is never mailed, never prefilled at checkout
  and shown as "Mobile sign-in" in the admin. Email customers can add a verified sign-in number on the account
  page; the password card only shows for accounts that have a password.
- **SMS providers:** `SMS_PROVIDER=dev-outbox` (stored in `OutboundSms`, code printed in the dev server window;
  phone sign-in switches off in production) and `msg91` (Flow API, DLT template; the code is never stored or
  logged, no blind retries). The MSG91 call is tested against a fake HTTP server only.
- Migration `20261109090000_phone_otp_signin` (additive). Seed gives the demo customer `9845012345`.
- Tests: integration +19 (`phone-auth.test.ts`), E2E +4 (`phone-login.spec.ts`); full suites green —
  unit + integration 458, E2E 64.

## Brand theme and motion redesign ✅

- **Brand identity from the Shayvera logo:** the lotus mark and wordmark were traced to small vector files
  (`public/brand/mark.svg`, `wordmark.svg`, `logo-full.svg`); favicon, app icons and the link-preview image
  are generated from them. Palette re-based on the logo: lotus green (primary), saffron (accent), leaf lime
  (highlights), on warm ivory; footer and promo use a deep green.
- **Motion system, CSS only (no animation library, no extra JavaScript):** hover lift + image zoom on product
  and category cards, drawing link underlines, nav dots, button press/arrow nudge; scroll-driven reveals for
  sections below the fold, a reading-progress bar, a header that settles on scroll, slow parallax on hero
  images, a brand ticker, and a quick cross-fade between pages (React `<ViewTransition>`). Hover effects only
  on pointer devices; all motion off for "reduce motion"; browsers without scroll-driven animations show
  everything statically.
- **Performance care:** Geist Mono dropped (system monospace) — fonts 107 → 83 KB; JavaScript unchanged
  (~226–245 KB per page); no layout shift (CLS 0). Grids at the top of listing pages don't fade in (it delayed
  the largest paint); header blur kept at the previous strength (a stronger blur cost ~0.1 s first paint on
  mobile). Measured against the previous design on the same machine (production build, 3 runs, median):
  JavaScript and total bytes unchanged, layout shift 0, first paint +0.02–0.1 s; largest paint +0.03–0.16 s
  (worst: mobile /shop at 4× CPU throttle, 0.63 → 0.80 s). Every page stays under 0.8 s, far inside the 2.5 s
  "good" threshold.
- Accessibility: brand orange and muted text darkened to keep AA contrast; the axe suite now waits for entrance
  animations to finish before scanning. All 64 E2E tests (incl. 21 axe scans) and lint pass.

## Premium interactions: reveals, cart drawer, quick view, gallery ✅

All nine requested enhancements, built on the existing CSS motion system — **no animation library
added** (Motion/GSAP were not needed: CSS transitions/keyframes + one IntersectionObserver cover every
effect, keeping JavaScript within +3–5 KB per page).

1. **Scroll reveals** — `RevealObserver` (one IntersectionObserver for the store) fades/slides sections up
   once, the first time they enter the viewport; grids stagger per row. Fail-safe: only elements the
   script has marked `data-reveal-pending` are hidden, so content is visible without JavaScript, before
   hydration, for late-streamed content and with reduced motion; anything on screen at load is never hidden.
2. **Product cards** — lift + shadow, second image cross-fade, zoom; Quick View / wishlist / add actions
   slide in on hover or focus (always visible on touch screens); add button shows a spinner, then
   "Added ✓", the cart badge pops and the cart drawer opens.
3. **Gallery** — thumbnails with active ring, cross-fade, prev/next arrows and counter, 2× cursor-following
   magnifier on fine pointers, touch swipe, fullscreen viewer (Radix Dialog) with arrow-key navigation,
   thumbnail strip and focus return. `object-cover`/`object-contain` with fixed aspect ratios; responsive
   `sizes`.
4. **Sticky header** — `HeaderShell` sets `data-scrolled` (passive, rAF-throttled) → deeper background and
   shadow, logo compacts by `scale` only (header height constant: no layout shift); wishlist icon added;
   active category link marked with `aria-current` and a dot indicator.
5. **Cart drawer** — Radix Sheet (focus trap, Escape/backdrop close, scroll lock, focus returns to the
   opener). Contents and totals from `GET /api/cart` (server-priced); quantity/remove via the existing item
   endpoints; removal slides out with an "Undo" toast; loading skeleton, error-with-retry and empty states;
   free-shipping hint; Checkout / View cart / Continue shopping. Opens from the header icon (still a real
   `/cart` link) and after adding a product. Loaded lazily on first use.
6. **Hero parallax** — background lotus and glow drift on scroll (scroll-driven CSS, desktop only, off for
   reduced motion); hero images drift within their frames; floating quote card.
7. **Categories** — staggered entrance, image zoom, deepening overlay, text lift with "· Explore", rotating
   arrow; whole card clickable.
8. **Text reveals** (selective) — hero headline line-by-line on load; promo and newsletter headings
   word-by-word on scroll (`RevealText`, real text in normal flow); supporting copy follows with a delay.
9. **Micro-interactions** — button press scale + hover shadow, arrow nudge; wishlist heart pop (only on
   user action); cart badge pop; drawer quantity/removal feedback; nav dot indicator; search panel slides
   in with a spinner while searching and a "No products match" state; inputs ease their border/ring and
   nudge when invalid; field errors slide in.

Tests: new `tests/e2e/interactions.spec.ts` (drawer add/quantity/remove/Escape/scroll-lock/focus return,
quick view → drawer, gallery next/fullscreen/keyboard, reveal + header state, reduced motion) — E2E 70/70,
unit 185, lint/typecheck/build clean. Accessibility suite (21 axe scans) passes; it waits for entrance
animations to settle. JS: `/` 229 KB, `/shop` 241, product 235, cart 230, login 248 (budget 250).

## React Bits: SplitText ✅

- Registry `@react-bits` added to `components.json`; installed with
  `npx shadcn@latest add @react-bits/SplitText-TS-TW` (TypeScript + Tailwind variant of SplitText, chosen over
  JS-CSS to match the project) → `src/components/react-bits/split-text.tsx` (strict-TS fixes only).
- New dependencies, pinned: `gsap@3.15.1`, `@gsap/react@2.1.2` (GSAP "Standard no-charge" licence, which
  includes SplitText and ScrollTrigger for commercial sites).
- `SplitHeading` (components/motion) renders the plain heading on the server and swaps in SplitText only when
  the heading is ~400px from the viewport, so GSAP (~49 KB gz) is never in a page's initial JavaScript, text is
  readable without JS, and reduced-motion visitors never download it. Used on the home page promo
  ("10% off…", letters rise) and newsletter heading (words blur in). The hero keeps the CSS line reveal (LCP).
- E2E: lazy-load + split + heading semantics test; suite 71/71; page JS unchanged (`/` 229 KB).
