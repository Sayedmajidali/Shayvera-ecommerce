# QA Report

Date: 2026-11-07 · Branch `claude/festive-franklin-tg5y03` (v2 Phase 14) · Environment: Linux cloud container,
Node 22.23, PostgreSQL 16.15 (native; no Docker daemon in the sandbox), Chromium via Playwright 1.63.
Supersedes the v1 report of 2026-11-05.

> **Verification honesty.** Everything below ran against the real application code and a real PostgreSQL
> database. Razorpay and Shiprocket were exercised through mocks/simulators and fake HTTP/SDK clients only —
> **no call was made to either provider's real API** (see §3). Passing tests show the code behaves as designed
> under the tested conditions; they are not a guarantee of absence of defects.

## 1. Results

| Check                                           | Command                    | Result                                                                                                  |
| ----------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Lint                                            | `npm run lint`             | ✅ 0 errors, 0 warnings                                                                                 |
| Typecheck (strict + `noUncheckedIndexedAccess`) | `npm run typecheck`        | ✅                                                                                                      |
| Unit tests                                      | `npm run test:unit`        | ✅ **185 / 185** (16 files)                                                                             |
| Integration tests (real PostgreSQL)             | `npm run test:integration` | ✅ **254 / 254** (23 files)                                                                             |
| End-to-end (production build, isolated DB)      | `npm run test:e2e`         | ✅ **60 / 60** (12 files; desktop Chrome + Pixel 7)                                                     |
| Code coverage (unit + integration)              | `npm run test:coverage`    | ✅ lines **84.6 %**, statements 82.0 %, functions 82.8 %, branches 72.4 % (enforced floors 80/78/78/68) |
| Production build                                | `npm run build`            | ✅                                                                                                      |
| Dependency audit (production)                   | `npm audit --omit=dev`     | ✅ 0 vulnerabilities (dev tooling: 8 moderate, accepted — SECURITY_REVIEW.md §3)                        |
| Performance at volume                           | `npm run perf:check`       | ✅ 14/14 within budget at 20k orders (500 ms) and 200k orders (1 s) — §6                                |

**Stability:** the complete unit + integration suite was run **three consecutive times** (432 tests each in Phase 14, no
failure, no retry) and the E2E suite **twice** (60/60 both times; Playwright retries are off outside CI). The new
concurrency suite was additionally run three times on its own.

## 2. Traceability to the testing strategy (specification §18)

### Unit tests (`tests/unit`)

| Required             | Where                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pricing              | `pricing.test.ts` (17): subtotal, MRP savings, free-shipping threshold, COD fee, integer-only outputs, largest-remainder allocation                                          |
| Discounts / coupons  | `pricing.test.ts`: percentage + cap, fixed ≤ subtotal, inactive/expired/not-yet-active, global and per-customer limits, minimum order                                        |
| Tax                  | `pricing.test.ts`: inclusive/exclusive GST per line, intra-state CGST/SGST, inter-state IGST, discount reduces taxable value; `money.test.ts` rounding                       |
| Shipping             | `package.test.ts` (parcel weight/box, courier units, volumetric weight), `shipping.test.ts` (body building, response parsing, IST timestamps), `shiprocket.test.ts` (client) |
| Inventory            | `inventory.test.ts` (available = on hand − reserved, never negative); transactional behaviour is in the integration suite                                                    |
| Order transitions    | `order-status.test.ts`: allowed and forbidden transitions, terminal states, groups                                                                                           |
| Payment verification | `signature.test.ts` (checkout + webhook HMAC, tampering, raw-body sensitivity); `gateway.test.ts` (real Razorpay adapter with a fake SDK: mapping, error classification)     |
| Shipment mapping     | `shipping.test.ts`: Shiprocket status codes → internal status, shipment → order status, attention codes                                                                      |
| Webhook dedupe       | `shipping.test.ts`: courier dedupe key (redelivery equal, new scan different, legacy field, fallback to body)                                                                |
| Retry rules          | `platform.test.ts`: backoff with full jitter, `httpJson` retries only idempotent requests, timeouts, `withTimeout`; `gateway.test.ts`: which HTTP outcomes are definitive    |

### Integration tests (`tests/integration`, route handlers and services against PostgreSQL)

| Required                | Where                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication          | `auth.test.ts` (15), `security-sweeps.test.ts` (Better Auth origin)                                                                                     |
| Authorization           | `rbac.test.ts` (every admin API: 401 anonymous / 403 without permission; role scoping), `security-sweeps.test.ts` (every admin page names a permission) |
| Database transactions   | throughout; explicitly `concurrency.test.ts`, `inventory.test.ts`, `checkout.test.ts`                                                                   |
| Product operations      | `catalog.test.ts`, `catalog-attributes.test.ts`, `importer.test.ts`                                                                                     |
| Cart operations         | `cart.test.ts`, `storefront.test.ts`                                                                                                                    |
| Checkout / order create | `checkout.test.ts`, `delivery.test.ts`                                                                                                                  |
| Inventory reservations  | `inventory.test.ts`, `order-lifecycle.test.ts`, `concurrency.test.ts`                                                                                   |
| Payment event handling  | `payments.test.ts` (22), `payments-hardening.test.ts` (10)                                                                                              |
| Shipment creation       | `shipping.test.ts` (19)                                                                                                                                 |
| Shipment updates        | `shipping.test.ts` (webhooks, polling, stale/terminal protection)                                                                                       |
| Refund workflows        | `payments.test.ts`, `payments-hardening.test.ts`, `returns-notifications.test.ts`                                                                       |
| Also covered            | jobs/outbox (`jobs.test.ts`), reports and dashboards (`reports.test.ts`, `dashboards.test.ts`), notifications, credit notes, security                   |

### External API scenarios (all **mocked** — see §3)

| Required                          | Test                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Razorpay success                  | `payments.test.ts` verified success; E2E `payments.spec.ts` "successful payment confirms the order"                                     |
| Razorpay failure                  | `payments.test.ts` failure + retry; E2E "failed payment … can be retried"; `gateway.test.ts` 4xx/5xx/timeout classification             |
| Razorpay duplicate webhook        | `payments.test.ts`, `payments-hardening.test.ts` (concurrent duplicates store one event, one job); E2E "duplicate and delayed webhooks" |
| Razorpay delayed webhook          | `payments.test.ts` delayed capture → reinstated / refunded when sold out; out-of-order failure                                          |
| Shiprocket successful shipment    | `shipping.test.ts` "books, assigns an AWB, generates a label…"; E2E `shipping.spec.ts`                                                  |
| Shiprocket API timeout            | `shipping.test.ts` "unknown booking outcome is looked up by reference before retrying"                                                  |
| Shiprocket duplicate request      | `shipping.test.ts` duplicate-reference (422) treated as existing; concurrent clicks → one booking                                       |
| Shiprocket tracking update        | `shipping.test.ts` webhook → shipped → out for delivery → delivered (COD paid); polling                                                 |
| Shiprocket invalid response       | `shipping.test.ts` "unreadable success response is an unknown outcome" (**new**); `shiprocket.test.ts` rejects unexpected shapes        |
| Shiprocket service unavailability | `shipping.test.ts` "service unavailable (503) … retried from the queue, one parcel" (**new**); `delivery.test.ts` checkout continues    |

### Playwright end-to-end (`tests/e2e`)

| Customer flow                            | Spec                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1–4 Browse, search, filter, open product | `customer.spec.ts` "browse, search, filter and view a product"                                   |
| 5–6 Add to cart, checkout                | `customer.spec.ts` "cart → coupon → COD checkout → order history"; `responsive.spec.ts` (phone)  |
| 7 Pay with Razorpay test mode            | `payments.spec.ts` — **Razorpay test-mode simulator**, not the real Razorpay Checkout            |
| 8 View order                             | `customer.spec.ts`, `requests.spec.ts`                                                           |
| 9 Track shipment                         | `shipping.spec.ts` (customer sees "Out for delivery"), `storefront-v2.spec.ts` (track by number) |

| Admin flow                 | Spec                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| 1 Login                    | every admin spec (`login` helper); `admin.spec.ts` customers blocked     |
| 2 Create product           | `admin.spec.ts` "creates a product, uploads an image and updates stock"  |
| 3 Update inventory         | same test (stock adjustment dialog)                                      |
| 4 Create coupon            | `admin.spec.ts` "creates a coupon"                                       |
| 5 Process order            | `admin.spec.ts` "views orders and updates an order status"               |
| 6 Create shipment          | `shipping.spec.ts` (book courier with quotes, AWB, pickup)               |
| 7 View shipment tracking   | `shipping.spec.ts`                                                       |
| 8 View payment information | `admin.spec.ts` "payments dashboard"                                     |
| 9 Cancellation / refund    | `requests.spec.ts` (approve cancellation; return → refund → credit note) |

### Concurrency (`tests/integration/concurrency.test.ts` and related)

| Required                         | Test                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Many users buying the last units | `checkout.test.ts` "8 buyers / 3 units → exactly 3 orders"                                                                                                   |
| Duplicate checkout requests      | `checkout.test.ts` concurrent double-submit with one idempotency key; E2E double-click                                                                       |
| Concurrent inventory updates     | `concurrency.test.ts` (**new**): 8 checkouts racing 3 staff adjustments; 20 parallel adjustments (no lost update); removals racing reservations              |
| Duplicate webhook events         | `payments-hardening.test.ts` (Razorpay, concurrent); `concurrency.test.ts` (**new**, courier: 5 simultaneous deliveries → 1 event, 1 job)                    |
| Concurrent shipment creation     | `shipping.test.ts` concurrent clicks → [201, 409, 409], one booking (DB partial unique index)                                                                |
| Also                             | conflicting order transitions (cancel vs pack → one wins, stock follows), concurrent refunds of one return, coupon global limit, duplicate stock adjustments |

Each concurrency test asserts **invariants** rather than an interleaving: on hand ≥ reserved ≥ 0, on-hand
change equals the ledger sum, reserved equals the open reservations (`findInventoryDrift` empty), no oversell.

## 3. Mocked vs real provider verification

| Integration             | What ran                                                                                                                                                          | Real provider                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Razorpay                | Mock gateway (signed payloads, simulated Checkout), failure-injecting gateways, **real adapter with a fake SDK client** (request mapping, error classes, timeout) | **Not verified** — needs `rzp_test_` keys; checklist in PAYMENT_INTEGRATION.md / README          |
| Shiprocket              | Mock courier with failure injection (timeout after create, 503, unreadable response, 422 duplicate, refusal); HTTP-level fake for auth/serviceability             | **Not verified** — no sandbox exists; needs the business's API user (SHIPPING_INTEGRATION.md §9) |
| Email                   | Development outbox (rendered messages stored and asserted)                                                                                                        | No provider configured                                                                           |
| Error-reporting webhook | Unit-tested with a stubbed `fetch`                                                                                                                                | Not connected                                                                                    |
| Docker image            | Not built (no Docker daemon in the sandbox)                                                                                                                       | Unverified                                                                                       |

## 4. Other quality gates in the suite

- **Security sweeps** (`security-sweeps.test.ts`): CSRF on all 69 mutating API handlers, Better Auth origin,
  admin page permissions, client/server import boundary, `server-only` on secret-reading modules, no unsafe raw
  SQL, non-cacheable API responses, rate limit on payment start, idempotent stock adjustments, system status
  never shows secrets.
- **Accessibility** (`accessibility.spec.ts`): axe WCAG 2.1 A/AA + best practice, failing on moderate, serious
  and critical issues, on 15 public pages, cart/checkout (with validation errors), account pages and menu, and
  18 admin pages; keyboard tests for skip link, visible focus, dialog focus trap/Escape/focus return, add to cart.
- **Performance budgets** (`performance.spec.ts`): compressed JavaScript ≤ 250 KB and time to first byte ≤ 1.5 s
  per storefront page on the production build (measured 226–241 KB, 9–21 ms); admin dashboard TTFB ≤ 2 s.

## 5. Coverage

`npm run test:coverage` instruments `src/server`, `src/lib` and `src/app/api` (UI components and pages are
exercised by Playwright, not instrumented). Totals: lines 84.6 %, statements 82.0 %, functions 82.8 %, branches
72.4 %; the run fails if lines < 80 %, statements < 78 %, functions < 78 % or branches < 68 %.

Lowest-covered files are thin route wrappers whose logic is tested through the module (`newsletter`,
`products/[slug]`, `search/suggest`, `admin/branding`, `shipments/[id]/refresh`), browser-only helpers
(`fetcher.ts`, `auth-client.ts`) and the development-only mock document route. Phase 14 added tests for the two
meaningful gaps it found: the Payments/Shipments dashboard queries (were 0 % in Vitest, now exact-count tests)
and the real Razorpay adapter (45 % → covered request mapping and error classification).

## 6. Performance at volume (`npm run perf:check`, separate database)

| Query (median of 5)         | 20,000 orders | 200,000 orders |
| --------------------------- | ------------- | -------------- |
| Dashboard figures (90 days) | 19 ms         | 104 ms         |
| Dashboard alerts            | 7 ms          | 66 ms          |
| Sales report (365 days)     | 42 ms         | 455 ms         |
| GST register (365 days)     | 140 ms\*      | 66 ms          |
| Orders list (page 1 / 500)  | 28 / 40 ms    | 313 / 327 ms   |
| Shipments / Payments        | 12 / 9 ms     | 51 / 36 ms     |
| Shop listing                | 3 ms          | 3 ms           |

\* before the Phase 13 change to SQL aggregation (it was 2.2 s at 200k orders).

## 7. Defects found by testing in v2 and fixed

| Phase | Defect                                                                                                                                                                                                              | Found by                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 7     | Emails suppressed for approved cancellations/received returns by an over-broad "restoring" guard                                                                                                                    | lifecycle integration test                         |
| 9     | Retrying a failed booking did nothing (job already SUCCEEDED); return pickup 500 (parcel spread)                                                                                                                    | shipping integration tests                         |
| 10    | Daily sales chart put orders placed 00:00–05:30 IST on the previous day (UTC stored as `timestamp`, converted the wrong way)                                                                                        | report integration test (IST boundary)             |
| 11    | Two simultaneous refunds of one return: the second failed with a misleading "exceeds refundable amount"                                                                                                             | concurrent refund test                             |
| 12    | Login CSRF on Better Auth sign-in/sign-up; open redirect via tab in `next`; stock adjustments applied twice on retry; Razorpay calls without timeout; stock dialog in the variants editor not sending its key       | security sweep, unit tests, E2E                    |
| 13    | GST register O(n) in memory (2.2 s); unlabelled field, menu hiding the page from screen readers, heading/landmark issues, duplicate product links                                                                   | `perf:check`, stricter axe scans                   |
| 14    | A Shiprocket success response without ids was treated as a **definite refusal** (booking FAILED, staff told to fix it) although the parcel might exist — now an unknown outcome, retried with a lookup by reference | new invalid-response workflow test                 |
| 15    | Intermittent axe failure on `/shop` and `/search`: the streamed loading skeleton had no page heading (screen readers saw a heading-less page while loading)                                                         | full-suite reruns; reproduced with `--repeat-each` |
| 14    | Product fixture not safe for parallel creation (duplicate SKU) — test-only                                                                                                                                          | new dashboard test                                 |

## 8. Known limitations (not covered by automated tests)

- Real Razorpay test-mode and Shiprocket API round trips, a real SMTP service and a real bucket (§3); Docker image build.
- Cross-browser: E2E runs on Chromium (desktop + Pixel 7 emulation) only; Safari/Firefox not tested.
- Load testing beyond the query-level `perf:check` (no concurrent-user HTTP load test).
- Visual regression testing is not set up; screenshots exist only for failed tests.
- Legal, tax (GST/credit-note format) and policy content need professional review; tests check arithmetic and
  consistency, not legal correctness.

## 9. How to run

```bash
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration          # needs DATABASE_URL_TEST (PostgreSQL)
npm run test:coverage             # unit + integration with coverage floors
npm run test:e2e                  # builds and starts the app on :3100 with DATABASE_URL_E2E
PERF_DATABASE_URL=postgresql://…/shayvera_perf npm run perf:check
```
