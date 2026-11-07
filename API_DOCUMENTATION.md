# API Documentation

All endpoints are Next.js Route Handlers under `/api`. JSON in, JSON out.

## Conventions

- **Success:** `200`/`201` with `{ "data": … }`.
- **Error:** `{ "error": { "code": string, "message": string, "details"?: object } }` — `details` maps field paths
  to messages for validation errors (e.g. `"shippingAddress.pincode": "Enter a valid 6-digit PIN code"`).

| Status    | Code(s)                                                         |
| --------- | --------------------------------------------------------------- |
| 400       | `VALIDATION_ERROR`                                              |
| 401       | `UNAUTHENTICATED`                                               |
| 403       | `FORBIDDEN` (role, CSRF origin, bad webhook signature)          |
| 404       | `NOT_FOUND` (also returned for resources owned by someone else) |
| 409       | `CONFLICT`, `OUT_OF_STOCK`, `INVALID_STATE`                     |
| 413 / 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA`                        |
| 422       | `BUSINESS_RULE`, `COUPON_INVALID`                               |
| 429       | `RATE_LIMITED`                                                  |
| 500 / 502 | `INTERNAL`, `PAYMENT_ERROR`                                     |

- **Auth:** Better Auth session cookie (`better-auth.session_token`, `__Secure-` prefix over HTTPS).
- **CSRF:** every cookie-authenticated `POST/PUT/PATCH/DELETE` must carry a same-origin `Origin` (or `Referer`)
  header — browsers do this automatically. Webhooks are exempt (HMAC-authenticated).
- **Money:** integer **paise** (`₹1 = 100`). Percentages in **basis points** (`10% = 1000`). Public catalog
  price filters (`minPrice`, `maxPrice`) are in **rupees**.
- **Body limits:** 64 KB JSON by default (checkout 32 KB, products 256 KB), uploads `UPLOAD_MAX_BYTES` (5 MB).
- **Guest cart:** httpOnly `shv_cart` cookie, issued on first add-to-cart.

---

## Authentication — `/api/auth/*` (Better Auth)

| Method | Path                               | Body                                                    | Notes                                                             |
| ------ | ---------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| POST   | `/api/auth/sign-up/email`          | `{ name, email, password }`                             | Password 8–128 chars, letter + number. Role is always `CUSTOMER`. |
| POST   | `/api/auth/sign-in/email`          | `{ email, password }`                                   | Rate limited 10/min. Disabled accounts → 403.                     |
| POST   | `/api/auth/sign-out`               | —                                                       |                                                                   |
| GET    | `/api/auth/get-session`            | —                                                       | Current session/user.                                             |
| POST   | `/api/auth/request-password-reset` | `{ email, redirectTo: "/reset-password" }`              | Always succeeds (no enumeration). Email goes to the dev outbox.   |
| POST   | `/api/auth/reset-password`         | `{ newPassword, token }`                                | Revokes all sessions.                                             |
| POST   | `/api/auth/change-password`        | `{ currentPassword, newPassword, revokeOtherSessions }` | Signed in.                                                        |

There is **no** admin sign-up endpoint. Administrators are created with `npm run admin:create`.

## Health

| GET | `/api/health` | `200 { status: "ok", database: "up" }` or `503`. |
| --- | ------------- | ------------------------------------------------ |

## Catalog (public)

| Method | Path                     | Query / notes                                                                                                                                                                                                                 |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/products`          | `q, category (slug), minPrice, maxPrice (₹), inStock=1, sort (featured\|newest\|price-asc\|price-desc\|bestselling\|rating), page` → `{ items, total, page, pageCount }` (12 per page). Invalid params fall back to defaults. |
| GET    | `/api/products/:slug`    | Active product with images, variants (price, stock), approved reviews.                                                                                                                                                        |
| GET    | `/api/search/suggest?q=` | Up to 6 suggestions `{ slug, name, image, pricePaise }`.                                                                                                                                                                      |

## Cart

| Method | Path                                                                    | Body                             | Notes                                                                                                                                                                       |
| ------ | ----------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/cart?state=KA&payment=COD`                                        | —                                | Server-priced cart: `lines`, `issues` (unavailable/out-of-stock/insufficient), `pricing` (subtotal, coupon, shipping, COD fee, GST split, total), `coupon`, `codAvailable`. |
| POST   | `/api/cart/items`                                                       | `{ variantId, quantity (1–10) }` | 201. Sets `shv_cart` for guests. 409 `OUT_OF_STOCK`.                                                                                                                        |
| PATCH  | `/api/cart/items/:id`                                                   | `{ quantity (0–10) }`            | 0 removes.                                                                                                                                                                  |
| DELETE | `/api/cart/items/:id`                                                   | —                                |                                                                                                                                                                             |
| POST   | `/api/cart/coupon`                                                      | `{ code }`                       | 422 `COUPON_INVALID` with reason. Rate limited.                                                                                                                             |
| DELETE | `/api/cart/coupon`                                                      | —                                |                                                                                                                                                                             |
| POST   | `/api/cart/merge`                                                       | —                                | Signed in. Merges the guest cart and clears the cookie.                                                                                                                     |
| GET    | `/api/cart?buy=<variantId>&qty=<1–10>&coupon=CODE&state=KA&payment=COD` | —                                | "Buy now" preview: prices just that item (cart not read; `id` is `null`). Coupon only from `coupon`.                                                                        |

## Checkout & orders

| Method | Path                                             | Body / notes                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/checkout`                                  | `{ idempotencyKey (uuid), email, phone, shippingAddress, billingSameAsShipping, billingAddress?, paymentMethod: "COD"\|"RAZORPAY", customerNote?, saveAddress? }` → `{ orderId, orderNumber, status, paymentMethod, totalPaise, accessToken, payment, idempotentReplay }`. 201 new, 200 replay. **No prices accepted.**                             |
| GET    | `/api/orders?page=`                              | Signed-in customer's orders.                                                                                                                                                                                                                                                                                                                        |
| GET    | `/api/orders/:orderNumber?t=`                    | Owner (session) or guest with access token `t`. Others → 404.                                                                                                                                                                                                                                                                                       |
| POST   | `/api/orders/:orderNumber/cancel`                | `{ reason?, token? }` → `{ outcome: "cancelled" \| "requested", status }`. Unpaid online orders (`PENDING`/`PAYMENT_FAILED`) are cancelled immediately; confirmed/processing/ready-to-ship orders become a **cancellation request** (staff decide). 409 once handed to the courier or while a request is open. Rate limited.                        |
| POST   | `/api/orders/:orderNumber/return`                | `{ reason (5–500), lines: [{ orderItemId, quantity }], token? }` → 201. Delivered orders within the store's return window (Settings, default 2 days); quantities cannot exceed what was ordered.                                                                                                                                                    |
| POST   | `/api/orders/:orderNumber/requests/:id/withdraw` | `{ token? }` — withdraw a pending request; the order returns to its previous status.                                                                                                                                                                                                                                                                |
| POST   | `/api/orders/:orderNumber/pay`                   | `{ token? }` — start/resume Razorpay payment for a pending order → payment session.                                                                                                                                                                                                                                                                 |
| POST   | `/api/orders/track`                              | `{ orderNumber, contact }` (email, or 10-digit mobile in any format) → `{ url: "/track/<number>?k=<read-only token>" }`. Every mismatch returns the same 404 message. Rate limited: 10 / 10 min per IP and 10 / h per order number. The token opens only `/track/:orderNumber` (status, items, shipment — no address, contact, payment or actions). |

**Delivery check**: `GET /api/shipping/serviceability?pincode=560034[&buy=<variantId>&qty=<n>]` (public, 60/min per IP)
→ `{ status: "serviceable" | "not_serviceable" | "unverified" | "skipped", codAvailable, etaDays }` for the current
cart (or a Buy-now item). Courier rates are never returned. `POST /api/checkout` repeats the check server-side: 422
with `details["shippingAddress.pincode"]` when no courier serves the PIN, 422 with `details.paymentMethod` when COD was
chosen where couriers only take prepaid parcels.

**Buy now**: `POST /api/checkout` also accepts `buyNow: { variantId, quantity (1–10) }` and `couponCode?`. Only that item is
ordered and priced server-side; the cart (items and saved coupon) is left unchanged.

Address object: `{ fullName, phone (Indian mobile), line1, line2?, landmark?, city, stateCode (e.g. "KA"), pincode (6 digits) }`.

## Payments

| Method | Path                             | Body / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/payments/razorpay/verify`  | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` from Checkout.js. Verifies HMAC, fetches the payment from Razorpay, checks amount → `{ outcome, status, paymentStatus }`. 400 on bad signature.                                                                                                                                                                                                                                                                                                                                                                                |
| POST   | `/api/payments/razorpay/failure` | `{ razorpay_order_id, razorpay_payment_id?, code?, description? }` — informational; confirmed with Razorpay before any change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/api/webhooks/razorpay`         | Razorpay webhook. Headers `X-Razorpay-Signature` (HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`, or `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` during rotation) and `X-Razorpay-Event-Id`. Verified events are stored and a processing job is queued in one transaction; the response (`{ ok: true, duplicate }`) does not wait for processing. Handles `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`; others are stored and acknowledged. 403 bad signature, 400 malformed. A redelivered event that never processed successfully is re-queued. |
| POST   | `/api/payments/mock/complete`    | **Dev/test only** (`PAYMENT_GATEWAY=mock`): `{ razorpayOrderId, outcome: "captured"\|"failed" }` → signed Checkout.js-style payload. 404 with the real gateway.                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Payment session (from checkout / pay): `{ keyId, razorpayOrderId, amountPaise, currency: "INR", orderNumber, gateway, prefill }`.

## Account (signed in)

| Method       | Path                               | Body                                                                                               |
| ------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET / PATCH  | `/api/account/profile`             | `{ name, phone? }`                                                                                 |
| GET / POST   | `/api/account/addresses`           | address + `{ label?, isDefault? }` (max 20)                                                        |
| PUT / DELETE | `/api/account/addresses/:id`       | owner only (others → 404)                                                                          |
| GET / POST   | `/api/account/wishlist`            | GET → `{ productIds }`; POST `{ productId }` (idempotent; products on sale only; max 200; 120/min) |
| DELETE       | `/api/account/wishlist/:productId` | removes from the caller's own wishlist only                                                        |

## Misc (public, rate limited)

| POST | `/api/newsletter` | `{ email }`                                 |
| ---- | ----------------- | ------------------------------------------- |
| POST | `/api/contact`    | `{ name, email, phone?, subject, message }` |

## Admin (role `ADMIN`; customers → 403, anonymous → 401; all mutations audit-logged)

Every admin endpoint also requires a permission from the caller's staff role (403 `FORBIDDEN` otherwise; staff
with no role get 403 everywhere). Permissions by endpoint group:

| Endpoints                                                | Permission                            |
| -------------------------------------------------------- | ------------------------------------- |
| `dashboard`                                              | `DASHBOARD_VIEW`                      |
| `orders` GET, `orders/:id` GET                           | `ORDERS_VIEW`                         |
| `orders/:id/status`, `invoice`, `reconcile`, `attention` | `ORDERS_MANAGE`¹                      |
| `orders/:id/shipments`                                   | `SHIPPING_MANAGE`                     |
| `orders/:id/refunds`                                     | `PAYMENTS_REFUND`                     |
| `products`, `variants`, `images`, `categories`           | `CATALOG_MANAGE`                      |
| `variants/:id/stock`                                     | `INVENTORY_MANAGE`                    |
| `customers` GET / `customers/:id` GET · PATCH            | `CUSTOMERS_VIEW` · `CUSTOMERS_MANAGE` |
| `coupons`                                                | `COUPONS_MANAGE`                      |
| `settings`, `branding`                                   | `SETTINGS_MANAGE`                     |
| `staff`, `roles`                                         | `ADMINS_MANAGE`                       |
| `requests` (list, approve, reject, receive)              | `RETURNS_MANAGE`²                     |

¹ Cancelling a paid online order also needs `PAYMENTS_REFUND`, because it refunds automatically.
² Approving a cancellation of a paid online order also needs `PAYMENTS_REFUND`; recording a return with restock
quantities also needs `INVENTORY_MANAGE`.

**Payments (admin)**: `/admin/payments` page (`PAYMENTS_VIEW`) · `POST /api/admin/payments/events/:id/retry` (`PAYMENTS_VIEW` +
`ORDERS_MANAGE`) re-queues a verified webhook event that was not processed (409 if already processed). Refunds whose
Razorpay outcome is unknown (timeout) stay `PENDING` with the amount reserved until reconciled against Razorpay's refund
list (matched by `notes.refundId`); a definite Razorpay rejection returns 502 with the reason and releases the amount.

**Requests (admin)**: `GET /api/admin/requests?status=&type=&page=` (default: open requests, oldest first) ·
`POST /api/admin/requests/:id/approve { note? }` — cancellation → order `CANCELLED` (stock released, or put back if
already packed) and a full refund for paid online orders, response `{ outcome, refundStarted, shipmentToCancel }`;
return → request `APPROVED` (customer emailed) · `POST /api/admin/requests/:id/reject { note (required) }` — order back
to its previous status (`DELIVERED` for returns), customer emailed · `POST /api/admin/requests/:id/receive
{ lines: [{ orderItemId, receivedQuantity, restockQuantity ≤ received }], note? }` — approved returns only; order
`RETURNED`; restocked units are recorded in the ledger as `RETURN`. Refunds are a separate step (order refunds
endpoint): a full refund of a cancelled/returned/delivered order moves it `REFUND_PENDING → REFUNDED`. Admin status
changes are refused (409) while a request is open.

| Method               | Path                                      | Notes                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET                  | `/api/admin/dashboard?range=7d\|30d\|90d` | KPIs, daily series, bestsellers, low stock, recent orders.                                                                                                                                                                                                                                                                           |
| GET / POST           | `/api/admin/categories`                   | `{ name, slug?, description?, parentId?, sortOrder, isActive, isFeatured, imageUrl?, seoTitle?, seoDescription? }`                                                                                                                                                                                                                   |
| PUT / DELETE         | `/api/admin/categories/:id`               | Delete blocked (409) while products exist.                                                                                                                                                                                                                                                                                           |
| GET / POST           | `/api/admin/products`                     | GET filters `q, status, categoryId, stock=out, page, pageSize`. POST `{ name, slug?, description, shortDescription?, brand?, categoryId, status, isFeatured, taxRateBps?, hsnCode?, seoTitle?, seoDescription?, variants: [{ sku, name, options, pricePaise, compareAtPricePaise?, initialStock?, lowStockThreshold?, isActive }] }` |
| GET / PATCH / DELETE | `/api/admin/products/:id`                 | DELETE → `{ action: "deleted" \| "archived" }` (archived when ordered before).                                                                                                                                                                                                                                                       |
| POST                 | `/api/admin/products/:id/variants`        | variant body. Variants also accept `weightGrams`, `lengthMm`, `breadthMm`, `heightMm` (positive integers; the three box sides all or none; null = store default package). Products accept `attributes: [{ name, value }]` (≤30, unique names, order kept); on PATCH the list replaces the existing one, omitted = unchanged.         |
| PUT / DELETE         | `/api/admin/variants/:id`                 | DELETE → deleted or deactivated.                                                                                                                                                                                                                                                                                                     |
| GET / POST           | `/api/admin/variants/:id/stock`           | GET ledger; POST `{ delta (≠0), reason: ADJUSTMENT\|RESTOCK\|DAMAGE\|RETURN\|CORRECTION, note? }` → `{ quantityOnHand, quantityReserved, available }`. Removals can never take on-hand below the units reserved for open orders (409).                                                                                               |
| POST                 | `/api/admin/products/:id/images`          | `multipart/form-data` `file`, `alt?` — JPG/PNG/WebP/AVIF, ≥200×200, ≤5 MB; re-encoded to WebP.                                                                                                                                                                                                                                       |
| PATCH                | `/api/admin/products/:id/images`          | `{ order: [imageId…] }`                                                                                                                                                                                                                                                                                                              |
| PATCH / DELETE       | `/api/admin/images/:id`                   | `{ alt }`                                                                                                                                                                                                                                                                                                                            |
| GET                  | `/api/admin/orders`                       | `q, status, payment, method, attention=1, page`                                                                                                                                                                                                                                                                                      |
| GET                  | `/api/admin/orders/:id`                   | Full detail incl. payments, refunds, events, history.                                                                                                                                                                                                                                                                                |
| POST                 | `/api/admin/orders/:id/status`            | `{ status: CONFIRMED\|PROCESSING\|SHIPPED\|DELIVERED\|CANCELLED, note? }` — state machine enforced; shipping needs a shipment; paid cancellations auto-refund.                                                                                                                                                                       |
| POST                 | `/api/admin/orders/:id/shipments`         | `{ carrier, trackingNumber?, trackingUrl?, notes?, markShipped }`                                                                                                                                                                                                                                                                    |
| POST                 | `/api/admin/orders/:id/refunds`           | `{ amountPaise, reason }` — Razorpay refund or manual record (COD).                                                                                                                                                                                                                                                                  |
| POST                 | `/api/admin/orders/:id/reconcile`         | Pull payment state from Razorpay.                                                                                                                                                                                                                                                                                                    |
| POST                 | `/api/admin/orders/:id/invoice`           | Issue (idempotent) → `{ invoiceNumber }`. View at `/invoice/:orderNumber`.                                                                                                                                                                                                                                                           |
| DELETE               | `/api/admin/orders/:id/attention`         | Clear the "needs attention" flag.                                                                                                                                                                                                                                                                                                    |
| GET                  | `/api/admin/customers`                    | `q, status, page`                                                                                                                                                                                                                                                                                                                    |
| GET / PATCH          | `/api/admin/customers/:id`                | PATCH `{ status: ACTIVE\|DISABLED }` (disabling revokes sessions).                                                                                                                                                                                                                                                                   |
| GET / POST           | `/api/admin/coupons`                      | `{ code, description?, type: PERCENTAGE\|FIXED, value, minOrderPaise, maxDiscountPaise?, usageLimit?, usageLimitPerUser?, startsAt?, expiresAt?, isActive }`                                                                                                                                                                         |
| PUT / DELETE         | `/api/admin/coupons/:id`                  | DELETE → deleted or deactivated (if used).                                                                                                                                                                                                                                                                                           |
| GET / PUT            | `/api/admin/settings`                     | Store, shipping, GST (GSTIN validated against state), COD, numbering, default package (`defaultPackageWeightGrams`, `defaultPackageLengthMm/BreadthMm/HeightMm`; optional — omitted keeps the current value).                                                                                                                        |
| POST                 | `/api/admin/branding`                     | `multipart/form-data` `file`, `folder=branding\|categories` → `{ url }`                                                                                                                                                                                                                                                              |
| GET / POST           | `/api/admin/staff`                        | POST `{ email, name, roleId }` → `{ userId, promoted }`. New people get a set-password email; an existing customer account is promoted (signed out, notified). 409 if already staff. Rate limited (20/h per inviter).                                                                                                                |
| PATCH / DELETE       | `/api/admin/staff/:id`                    | PATCH `{ roleId?, status?: ACTIVE\|DISABLED }`; DELETE removes staff access (account remains a customer account). 409 for self-edits or when it would leave no active Owner.                                                                                                                                                         |
| POST                 | `/api/admin/staff/:id/invite`             | Re-send the set-password email (only while no password is set; 5/h).                                                                                                                                                                                                                                                                 |
| GET / POST           | `/api/admin/roles`                        | POST `{ name, description?, permissions: AdminPermission[] }` (unknown permissions → 400; duplicates removed).                                                                                                                                                                                                                       |
| PATCH / DELETE       | `/api/admin/roles/:id`                    | Owner role is fixed (409); built-in roles cannot be renamed or deleted; roles in use cannot be deleted.                                                                                                                                                                                                                              |

### Reports and operations (v2 Phase 10)

| Method | Path                        | Permission     | Notes                                                                                                                                                                                                                       |
| ------ | --------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/reports/export` | `REPORTS_VIEW` | `report=daily\|products\|categories\|states\|coupons\|gst\|hsn`, `from`, `to` (YYYY-MM-DD, India days, `to` inclusive, max 366 days; default last 30) → `text/csv` attachment (UTF-8 BOM, amounts in rupees). Audit-logged. |
| POST   | `/api/admin/jobs/:id/retry` | `JOBS_MANAGE`  | Fresh attempts for a `DEAD`/`FAILED` job (409 otherwise). Audit-logged.                                                                                                                                                     |

Admin pages added: `/admin/reports` (`REPORTS_VIEW`), `/admin/invoices` (`ORDERS_VIEW`), `/admin/jobs` (`JOBS_MANAGE`).

### Returns, credit notes, alerts (v2 Phase 11)

| Method | Path                                            | Permission                           | Notes                                                                                                                                                                                                          |
| ------ | ----------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/requests/:id/refund`                | `RETURNS_MANAGE`                     | Quote for a received return → `{ items[{name, quantity, valuePaise}], itemsPaise, shippingPaise, remainingPaise, paid, refund }`.                                                                              |
| POST   | `/api/admin/requests/:id/refund`                | `RETURNS_MANAGE` + `PAYMENTS_REFUND` | `{ amountPaise, includeShipping?, note? }` → 201 `{ refundId, status }`. 409 before receipt or if already refunded (one live refund per return, DB-enforced); 400 above the received value (+ fees if chosen). |
| GET    | `/credit-note/:id` (page)                       | admin, order owner, or guest `?t=`   | Printable credit note (same access rule as `/invoice/:orderNumber`).                                                                                                                                           |
| GET    | `/api/admin/reports/export?report=credit-notes` | `REPORTS_VIEW`                       | Credit-note register CSV (also part of the GST card on `/admin/reports`).                                                                                                                                      |

`PUT /api/admin/settings` also accepts (optional) `alertEmails: string[]` (≤ 5, de-duplicated, lower-cased),
`autoIssueInvoice: boolean` and `creditNotePrefix` (2–6 letters).

### Shipping (v2 Phase 9, `SHIPPING_MANAGE` unless noted)

| Method    | Path                                         | Notes                                                                                                                                                                         |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET       | `/api/admin/orders/:id/courier-quotes`       | → `{ parcel, couriers[{courierId,name,ratePaise,cod,etaDays}], recommendedCourierId, available }` (store cost; admin only).                                                   |
| POST      | `/api/admin/orders/:id/book-shipment`        | `{ courierId?, weightGrams?, lengthMm?, breadthMm?, heightMm? }` → 201 `{ shipmentId }`; booking runs as a job. 409 if an active booking exists; 422 manual mode / no pickup. |
| POST      | `/api/admin/shipments/:id/pickup`            | `{ date?: YYYY-MM-DD }` → schedules pickup and fetches the manifest.                                                                                                          |
| GET       | `/api/admin/shipments/:id/document?kind=`    | `label\|manifest` → `{ url }` (generated on first request).                                                                                                                   |
| POST      | `/api/admin/shipments/:id/cancel`            | `{ reason }` — before pickup only (409 after).                                                                                                                                |
| POST      | `/api/admin/shipments/:id/retry`             | Retry a `FAILED` booking.                                                                                                                                                     |
| POST      | `/api/admin/shipments/:id/refresh`           | Pull tracking from the courier now.                                                                                                                                           |
| POST      | `/api/admin/requests/:id/return-pickup`      | `RETURNS_MANAGE` + `SHIPPING_MANAGE`. Reverse pickup for an approved return.                                                                                                  |
| GET / PUT | `/api/admin/pickup-location`                 | `SETTINGS_MANAGE`. `{ name, contactName, phone, email, line1, line2?, city, stateCode, pincode }` — `name` = Shiprocket pickup nickname; also sets the store PIN.             |
| POST      | `/api/webhooks/courier` (public)             | Shiprocket tracking webhook. Header `x-api-key` = `SHIPROCKET_WEBHOOK_TOKEN` (401 otherwise); 256 KB cap; stored + queued → `{ ok, duplicate }`.                              |
| GET       | `/api/shipping/mock-document?kind=` (public) | Placeholder label/manifest; 404 unless `SHIPPING_PROVIDER=mock`.                                                                                                              |

## Non-API routes of note

| Path                                              | Purpose                                           |
| ------------------------------------------------- | ------------------------------------------------- |
| `/media/:key…`                                    | Uploaded images (immutable cache, `nosniff`).     |
| `/invoice/:orderNumber?t=`                        | Printable invoice (admin, owner, or guest token). |
| `/order/:orderNumber?t=`                          | Order confirmation/status page.                   |
| `/sitemap.xml`, `/robots.txt`, `/opengraph-image` | SEO.                                              |
