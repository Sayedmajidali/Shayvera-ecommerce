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
