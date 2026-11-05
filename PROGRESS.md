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
