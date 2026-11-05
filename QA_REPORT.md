# QA Report

Date: 2026-11-05 · Build: branch `claude/festive-franklin-tg5y03` · Environment: Linux cloud container,
Node 22.23, PostgreSQL 16.15 (native; Docker daemon unavailable in the sandbox), Chromium (Playwright 1.63).

## 1. Results

| Check                                           | Command                    | Result                                                                                                          |
| ----------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Lint                                            | `npm run lint`             | ✅ 0 errors, 0 warnings                                                                                         |
| Typecheck (strict + `noUncheckedIndexedAccess`) | `npm run typecheck`        | ✅                                                                                                              |
| Unit tests                                      | `npm run test:unit`        | ✅ 77 / 77 (6 files)                                                                                            |
| Integration tests (real PostgreSQL)             | `npm run test:integration` | ✅ 100 / 100 (7 files)                                                                                          |
| End-to-end (production build)                   | `npm run test:e2e`         | ✅ 29 / 29 (desktop + mobile, incl. 11 axe scans)                                                               |
| Production build                                | `npm run build`            | ✅                                                                                                              |
| Dependency audit                                | `npm audit`                | ⚠️ 3 high (Prisma CLI transitive, not runtime-reachable), 8 moderate (lint tooling) — see SECURITY_REVIEW.md §3 |

The full unit + integration suite was run three consecutive times without failures; the E2E suite twice.

## 2. Coverage by requirement

### Unit (`tests/unit`)

| Area                 | Cases                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pricing engine       | subtotal, MRP savings, free-shipping threshold and remaining amount, coupon before threshold, COD fee, inclusive GST per line, intra-state CGST/SGST, inter-state IGST, exclusive GST incl. charges, discount reducing taxable value, empty cart, invalid quantities, integer-only outputs, largest-remainder allocation |
| Coupons              | percentage + cap, fixed ≤ subtotal, inactive, expired, not-yet-active, global limit, min order, per-customer limit (known/unknown customer)                                                                                                                                                                              |
| Money                | INR grouping, rupee parsing without float error, half-away-from-zero rounding, bps                                                                                                                                                                                                                                       |
| India                | mobile normalisation/validation, PIN codes, GSTIN checksum/state                                                                                                                                                                                                                                                         |
| Order transitions    | all allowed and representative forbidden transitions, terminal state, financial-year rollover (IST)                                                                                                                                                                                                                      |
| Payment verification | checkout and webhook HMAC (tampering, wrong secret, raw-body sensitivity, malformed signatures)                                                                                                                                                                                                                          |
| Security helpers     | open-redirect guard, storage-key traversal, proxy-aware client IP, magic-byte sniffing, HTML escaping                                                                                                                                                                                                                    |

### Integration (`tests/integration`, real database, route handlers invoked directly)

| Area          | Highlights                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (15)     | registration, role-escalation attempts, duplicate/weak passwords, login, session persistence + sign-out, disabled accounts, password reset + token reuse, no enumeration, admin provisioning, 401/403/CSRF, cross-customer address isolation, PIN/state validation                                                                                                                                                     |
| Catalog (15)  | admin-only access, category CRUD + non-empty delete block, product create + stock ledger, validation, duplicate SKU, min-price recompute, delete vs archive, stock never negative, valid upload re-encoded, rejected disguised script/SVG/php/tiny/oversized/non-admin uploads, search/filter/sort/pagination                                                                                                          |
| Cart (16)     | guest cookie, stock limits, invalid quantities, draft/unknown products, cross-guest isolation, stock drops & deactivation, live price changes, coupon re-validation & rejection reasons, per-customer limit, guest→user merge                                                                                                                                                                                          |
| Checkout (15) | snapshots, stock + ledger, confirmation email, client amounts ignored, **idempotency under concurrent double-submit**, validation, empty/out-of-stock, COD rules, GST split by state, **8 buyers / 3 units → exactly 3 orders**, coupon global-limit race, unique order numbers, guest per-email coupon limit, owner/guest-token access, cancel → restock + coupon release, invalid transition                         |
| Payments (22) | verified success, tampered signature, duplicate/concurrent callbacks, failure + retry, resume, stranger access, webhook signature, duplicate webhooks, callback/webhook race, out-of-order failure, amount mismatch, unknown events, expiry, delayed capture → reinstated / refunded when sold out, interrupted checkout reconciliation, partial/full/concurrent refunds, customer-cancel auto-refund, refund webhooks |
| Admin (11)    | 401/403 on every admin API, process → ship (tracking) → deliver (COD paid) with emails + audit, invalid transitions, manual refund + filters, GST invoice numbering/snapshot (intra/inter, idempotent, unregistered), customer disable/enable with session revocation, coupon CRUD, settings validation (GSTIN checksum + state), dashboard arithmetic                                                                 |
| Security (6)  | server-side password policy, media traversal, webhook and JSON size limits, malformed JSON, missing Origin, no internal error leakage                                                                                                                                                                                                                                                                                  |

### End-to-end (`tests/e2e`, Playwright, production build, isolated DB)

| Flow                                                                                                                                                    | Spec                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Browse, search (live suggestions), category + price filters, sort, product page                                                                         | `customer.spec.ts`      |
| Register → add variants → change quantity → apply coupon → COD checkout → order history → cancel (stock restored)                                       | `customer.spec.ts`      |
| Double-click on "Place order" creates one order                                                                                                         | `customer.spec.ts`      |
| Online payment success · failure + retry · interrupted (modal closed) + later payment · duplicate & delayed webhooks · forged webhook rejected          | `payments.spec.ts`      |
| Admin: analytics (incl. table view), create product, upload image, invalid upload rejected, stock adjustment, create coupon, find order + update status | `admin.spec.ts`         |
| Customer blocked from admin UI (redirect) and APIs (403); anonymous 401                                                                                 | `admin.spec.ts`         |
| Sold-out variant, invalid/expired coupon, stock vanishing before checkout, protected-page redirects, branded 404 with real status                       | `edge-cases.spec.ts`    |
| Mobile navigation, filters sheet, no horizontal overflow                                                                                                | `responsive.spec.ts`    |
| WCAG 2.1 A/AA axe scans (home, shop, category, product, search, login, register, contact, policy, cart, checkout, admin)                                | `accessibility.spec.ts` |

## 3. Defects found during QA and fixed

| #   | Severity | Defect                                                                                                  | Fix                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | High     | Admin pages authorised only in the layout (not re-run on client navigation).                            | Per-page `requireAdminPage()`.                   |
| 2   | High     | Checkout page refreshed after order creation, redirecting to `/cart` and unmounting the payment modal.  | Refresh only after navigating to the order page. |
| 3   | Medium   | Missing products/categories/orders returned HTTP 200 (soft 404) because of a group-level `loading.tsx`. | Loading skeletons scoped to listing pages.       |
| 4   | Medium   | Colour contrast below AA for brand/success/destructive small text.                                      | Tokens darkened; axe scans now pass.             |
| 5   | Medium   | Weak passwords accepted by the API (UI-only check).                                                     | Better Auth `before` hook.                       |
| 6   | Low      | Invalid ARIA (`aria-label` on role-less div), `<p>` inside `<dl>`.                                      | Fixed markup.                                    |
| 7   | Low      | Payment-signature failures returned 502.                                                                | Return 400.                                      |
| 8   | Low      | Integration tests raced fire-and-forget emails (intermittent failure).                                  | Tests poll for the side effect.                  |
| 9   | Low      | Prisma logged expected duplicate-event unique violations as errors.                                     | Pre-check before insert.                         |

No known critical or high-priority defects remain open.

## 4. Not verified in this environment

- **Real Razorpay test-mode round trip** (Checkout.js + API + dashboard webhooks): Razorpay hosts are blocked by
  the sandbox network policy. All server logic is exercised with correctly signed payloads and the mock gateway.
  Run the checklist in README → "Razorpay test mode" on a developer machine.
- **Docker Compose** start-up (no Docker daemon in the sandbox). PostgreSQL 16 was run natively with the same
  configuration; the compose file is standard.
- **Windows-specific behaviour** (paths, line endings). Scripts avoid shell-specific commands; `.gitattributes`
  enforces LF.
- Cross-browser testing beyond Chromium (Firefox/WebKit not installed in the sandbox).
- Load/performance testing under production-like traffic.

## 5. How to reproduce

```bash
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration   # needs DATABASE_URL_TEST
npm run test:e2e           # needs DATABASE_URL_E2E; builds and starts the app on :3100
npm run build
```
