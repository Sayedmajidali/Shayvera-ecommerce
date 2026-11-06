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

| Method | Path                             | Body                             | Notes                                                                                                                                                                       |
| ------ | -------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/cart?state=KA&payment=COD` | —                                | Server-priced cart: `lines`, `issues` (unavailable/out-of-stock/insufficient), `pricing` (subtotal, coupon, shipping, COD fee, GST split, total), `coupon`, `codAvailable`. |
| POST   | `/api/cart/items`                | `{ variantId, quantity (1–10) }` | 201. Sets `shv_cart` for guests. 409 `OUT_OF_STOCK`.                                                                                                                        |
| PATCH  | `/api/cart/items/:id`            | `{ quantity (0–10) }`            | 0 removes.                                                                                                                                                                  |
| DELETE | `/api/cart/items/:id`            | —                                |                                                                                                                                                                             |
| POST   | `/api/cart/coupon`               | `{ code }`                       | 422 `COUPON_INVALID` with reason. Rate limited.                                                                                                                             |
| DELETE | `/api/cart/coupon`               | —                                |                                                                                                                                                                             |
| POST   | `/api/cart/merge`                | —                                | Signed in. Merges the guest cart and clears the cookie.                                                                                                                     |

## Checkout & orders

| Method | Path                              | Body / notes                                                                                                                                                                                                                                                                                                            |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/checkout`                   | `{ idempotencyKey (uuid), email, phone, shippingAddress, billingSameAsShipping, billingAddress?, paymentMethod: "COD"\|"RAZORPAY", customerNote?, saveAddress? }` → `{ orderId, orderNumber, status, paymentMethod, totalPaise, accessToken, payment, idempotentReplay }`. 201 new, 200 replay. **No prices accepted.** |
| GET    | `/api/orders?page=`               | Signed-in customer's orders.                                                                                                                                                                                                                                                                                            |
| GET    | `/api/orders/:orderNumber?t=`     | Owner (session) or guest with access token `t`. Others → 404.                                                                                                                                                                                                                                                           |
| POST   | `/api/orders/:orderNumber/cancel` | `{ reason?, token? }` — only `PENDING`/`CONFIRMED`. Paid online orders are refunded automatically.                                                                                                                                                                                                                      |
| POST   | `/api/orders/:orderNumber/pay`    | `{ token? }` — start/resume Razorpay payment for a pending order → payment session.                                                                                                                                                                                                                                     |

Address object: `{ fullName, phone (Indian mobile), line1, line2?, landmark?, city, stateCode (e.g. "KA"), pincode (6 digits) }`.

## Payments

| Method | Path                             | Body / notes                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/payments/razorpay/verify`  | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` from Checkout.js. Verifies HMAC, fetches the payment from Razorpay, checks amount → `{ outcome, status, paymentStatus }`. 400 on bad signature.                                                                    |
| POST   | `/api/payments/razorpay/failure` | `{ razorpay_order_id, razorpay_payment_id?, code?, description? }` — informational; confirmed with Razorpay before any change.                                                                                                                                                      |
| POST   | `/api/webhooks/razorpay`         | Razorpay webhook. Headers `X-Razorpay-Signature` (HMAC-SHA256 of raw body with `RAZORPAY_WEBHOOK_SECRET`) and `X-Razorpay-Event-Id`. Handles `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`. Duplicates → `{ ok: true, duplicate: true }`. |
| POST   | `/api/payments/mock/complete`    | **Dev/test only** (`PAYMENT_GATEWAY=mock`): `{ razorpayOrderId, outcome: "captured"\|"failed" }` → signed Checkout.js-style payload. 404 with the real gateway.                                                                                                                     |

Payment session (from checkout / pay): `{ keyId, razorpayOrderId, amountPaise, currency: "INR", orderNumber, gateway, prefill }`.

## Account (signed in)

| Method       | Path                         | Body                                        |
| ------------ | ---------------------------- | ------------------------------------------- |
| GET / PATCH  | `/api/account/profile`       | `{ name, phone? }`                          |
| GET / POST   | `/api/account/addresses`     | address + `{ label?, isDefault? }` (max 20) |
| PUT / DELETE | `/api/account/addresses/:id` | owner only (others → 404)                   |

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

¹ Cancelling a paid online order also needs `PAYMENTS_REFUND`, because it refunds automatically.

| Method               | Path                                      | Notes                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET                  | `/api/admin/dashboard?range=7d\|30d\|90d` | KPIs, daily series, bestsellers, low stock, recent orders.                                                                                                                                                                                                                                                                           |
| GET / POST           | `/api/admin/categories`                   | `{ name, slug?, description?, parentId?, sortOrder, isActive, isFeatured, imageUrl?, seoTitle?, seoDescription? }`                                                                                                                                                                                                                   |
| PUT / DELETE         | `/api/admin/categories/:id`               | Delete blocked (409) while products exist.                                                                                                                                                                                                                                                                                           |
| GET / POST           | `/api/admin/products`                     | GET filters `q, status, categoryId, stock=out, page, pageSize`. POST `{ name, slug?, description, shortDescription?, brand?, categoryId, status, isFeatured, taxRateBps?, hsnCode?, seoTitle?, seoDescription?, variants: [{ sku, name, options, pricePaise, compareAtPricePaise?, initialStock?, lowStockThreshold?, isActive }] }` |
| GET / PATCH / DELETE | `/api/admin/products/:id`                 | DELETE → `{ action: "deleted" \| "archived" }` (archived when ordered before).                                                                                                                                                                                                                                                       |
| POST                 | `/api/admin/products/:id/variants`        | variant body                                                                                                                                                                                                                                                                                                                         |
| PUT / DELETE         | `/api/admin/variants/:id`                 | DELETE → deleted or deactivated.                                                                                                                                                                                                                                                                                                     |
| GET / POST           | `/api/admin/variants/:id/stock`           | GET ledger; POST `{ delta (≠0), reason: ADJUSTMENT\|RESTOCK\|DAMAGE\|RETURN\|CORRECTION, note? }` — never below 0.                                                                                                                                                                                                                   |
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
| GET / PUT            | `/api/admin/settings`                     | Store, shipping, GST (GSTIN validated against state), COD, numbering.                                                                                                                                                                                                                                                                |
| POST                 | `/api/admin/branding`                     | `multipart/form-data` `file`, `folder=branding\|categories` → `{ url }`                                                                                                                                                                                                                                                              |
| GET / POST           | `/api/admin/staff`                        | POST `{ email, name, roleId }` → `{ userId, promoted }`. New people get a set-password email; an existing customer account is promoted (signed out, notified). 409 if already staff. Rate limited (20/h per inviter).                                                                                                                |
| PATCH / DELETE       | `/api/admin/staff/:id`                    | PATCH `{ roleId?, status?: ACTIVE\|DISABLED }`; DELETE removes staff access (account remains a customer account). 409 for self-edits or when it would leave no active Owner.                                                                                                                                                         |
| POST                 | `/api/admin/staff/:id/invite`             | Re-send the set-password email (only while no password is set; 5/h).                                                                                                                                                                                                                                                                 |
| GET / POST           | `/api/admin/roles`                        | POST `{ name, description?, permissions: AdminPermission[] }` (unknown permissions → 400; duplicates removed).                                                                                                                                                                                                                       |
| PATCH / DELETE       | `/api/admin/roles/:id`                    | Owner role is fixed (409); built-in roles cannot be renamed or deleted; roles in use cannot be deleted.                                                                                                                                                                                                                              |

## Non-API routes of note

| Path                                              | Purpose                                           |
| ------------------------------------------------- | ------------------------------------------------- |
| `/media/:key…`                                    | Uploaded images (immutable cache, `nosniff`).     |
| `/invoice/:orderNumber?t=`                        | Printable invoice (admin, owner, or guest token). |
| `/order/:orderNumber?t=`                          | Order confirmation/status page.                   |
| `/sitemap.xml`, `/robots.txt`, `/opengraph-image` | SEO.                                              |
