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
