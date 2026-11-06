# Database Design

PostgreSQL 16, managed through Prisma migrations (`prisma/migrations`). The authoritative
definition is `prisma/schema.prisma`; this document explains intent.

## Conventions

- Primary keys: `cuid()` strings (non-enumerable).
- Money: `Int` **paise** (₹1 = 100 paise). Percentages: `Int` **basis points** (18% = 1800).
- Timestamps: `createdAt` / `updatedAt` (`timestamptz`).
- Historical records (orders, order items, invoices, payments, ledger rows) are never cascaded
  away by catalog changes: references from history to catalog use `ON DELETE SET NULL` and the
  row keeps a **snapshot** (name, SKU, price, tax rate, address JSON).
- Products are **archived**, not deleted, once they have orders.

## Entity map

```
User 1─* Session, Account (Better Auth)        Verification (Better Auth tokens)
User 1─* Address
User 1─1 Cart 1─* CartItem *─1 ProductVariant
Category 1─* Category (parent/children)
Category 1─* Product 1─* ProductImage
                     1─* ProductVariant 1─1 Inventory 1─* InventoryTransaction
                     1─* Review *─1 User
User 1─* Order 1─* OrderItem
               1─* OrderStatusHistory
               1─* Payment 1─* PaymentEvent
               1─* Shipment
               1─* Refund
               1─1 Invoice
               1─0..1 CouponUsage *─1 Coupon
StoreSettings (singleton row id = "default")
AdminAuditLog *─1 User
Sequence (named counters: order numbers, invoice numbers per financial year)
OutboundEmail, NewsletterSubscriber, ContactMessage, RateLimitBucket
```

## Tables

| Table                                  | Purpose                                                                    | Key constraints / indexes                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `user`                                 | Better Auth user + `role`, `status`, `phone`                               | unique `email`                                                                                             |
| `session` / `account` / `verification` | Better Auth                                                                | unique `token`; FK cascade on user delete                                                                  |
| `Address`                              | Saved customer addresses (Indian format: `stateCode`, 6-digit `pincode`)   | idx `userId`; cascade on user delete                                                                       |
| `Category`                             | Hierarchical categories, SEO fields                                        | unique `slug`; idx `parentId`, `isActive`                                                                  |
| `Product`                              | Catalog item; status `DRAFT/ACTIVE/ARCHIVED`; GST rate (bps), HSN          | unique `slug`; idx (`status`,`categoryId`), `isFeatured`, `createdAt`                                      |
| `ProductImage`                         | Image metadata (storage key, w/h, bytes, mime)                             | idx (`productId`,`sortOrder`); cascade on product delete                                                   |
| `ProductVariant`                       | Sellable unit: SKU, options JSON, price/compare-at price                   | unique `sku`; idx `productId`                                                                              |
| `Inventory`                            | 1:1 with variant: `quantityOnHand`, `lowStockThreshold`                    | PK `variantId`; CHECK `quantityOnHand >= 0`                                                                |
| `InventoryTransaction`                 | Append-only stock ledger (`delta`, `reason`, `balanceAfter`, order ref)    | idx (`variantId`,`createdAt`)                                                                              |
| `Cart`                                 | Either `userId` (unique) or `guestToken` (unique)                          | `expiresAt` for guest cleanup                                                                              |
| `CartItem`                             | Variant + qty                                                              | unique (`cartId`,`variantId`); CHECK `quantity > 0`                                                        |
| `Order`                                | Header + totals snapshot + address JSON snapshots                          | unique `orderNumber`, unique `idempotencyKey`; idx (`userId`,`createdAt`), (`status`,`createdAt`), `email` |
| `OrderItem`                            | Immutable line snapshot (name, sku, unit price, tax, totals)               | FKs to product/variant `SET NULL`                                                                          |
| `OrderStatusHistory`                   | Audit of every transition                                                  | idx (`orderId`,`createdAt`)                                                                                |
| `Payment`                              | One per payment attempt (Razorpay order) or COD                            | unique `razorpayOrderId`, `razorpayPaymentId`                                                              |
| `PaymentEvent`                         | Every webhook/callback received (raw payload, signature validity)          | unique `eventId` → idempotent processing                                                                   |
| `Coupon`                               | FIXED (paise) or PERCENTAGE (bps), min order, max discount, limits, window | unique `code` (stored uppercase)                                                                           |
| `CouponUsage`                          | One per order using a coupon                                               | unique `orderId`; idx (`couponId`,`userId`), (`couponId`,`email`)                                          |
| `Review`                               | Rating 1–5, moderation status                                              | unique (`productId`,`userId`)                                                                              |
| `Shipment`                             | Manual carrier + tracking (extensible for courier APIs)                    | idx `orderId`                                                                                              |
| `Refund`                               | Refund records (Razorpay or manual)                                        | unique `razorpayRefundId`                                                                                  |
| `Invoice`                              | Number + immutable JSON snapshot (seller GSTIN, buyer, lines, tax split)   | unique `orderId`, unique `invoiceNumber`                                                                   |
| `StoreSettings`                        | Store config: contact, GST, shipping, COD rules, min order                 | singleton                                                                                                  |
| `AdminAuditLog`                        | Who did what to which entity                                               | idx (`entityType`,`entityId`), `createdAt`                                                                 |
| `Sequence`                             | Atomic counters (`UPDATE … RETURNING`)                                     | PK `key`                                                                                                   |
| `OutboundEmail`                        | Dev email sink / outbox                                                    | idx `to`                                                                                                   |
| `RateLimitBucket`                      | Fixed-window counters                                                      | PK `key`                                                                                                   |
| `rateLimit`                            | Better Auth rate-limit storage (auth endpoints)                            | unique `key`                                                                                               |
| `NewsletterSubscriber`                 | Newsletter sign-ups                                                        | unique `email`                                                                                             |
| `ContactMessage`                       | Contact-form submissions (Admin → Messages)                                | idx (`handled`,`createdAt`)                                                                                |

## Deletion behaviour

| Parent deleted | Child behaviour                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| User           | Sessions, accounts, addresses, cart: CASCADE. Orders: `userId` SET NULL (orders keep email/address snapshot). Reviews: CASCADE. Audit logs: SET NULL. |
| Product        | Images, variants: CASCADE (only allowed when no orders; otherwise archive). OrderItem refs: SET NULL.                                                 |
| Variant        | Inventory + ledger: CASCADE; CartItem: CASCADE; OrderItem ref: SET NULL.                                                                              |
| Category       | Products: RESTRICT (must move products first). Children: SET NULL.                                                                                    |
| Order          | Never deleted by the application.                                                                                                                     |

## Concurrency-sensitive operations

- Stock reservation: conditional `updateMany` (`quantityOnHand >= n`) inside the order transaction.
- Coupon global usage limit: conditional increment `usedCount < usageLimit` inside the order transaction.
- Order/invoice numbers: `Sequence` row incremented with `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
- Webhook idempotency: unique `PaymentEvent.eventId`; payment state transitions are guarded by
  conditional updates on the current status.

## v2 additions (planned in v2 Phase 0, implemented phase by phase)

| Entity                                       | Purpose                                                                                                              | Key constraints                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `AdminRole`                                  | named role with `permissions AdminPermission[]` (enum array)                                                         | unique `name`; built-ins seeded                     |
| `User.adminRoleId`                           | role for staff users (`role = ADMIN`)                                                                                | FK `SET NULL`                                       |
| `WishlistItem`                               | customer wishlist                                                                                                    | unique (`userId`,`productId`)                       |
| `ProductAttribute`                           | specifications (name/value, ordered)                                                                                 | idx (`productId`,`sortOrder`)                       |
| `ProductVariant.lengthMm/breadthMm/heightMm` | packed box for shipping (with `weightGrams`); null = store default package                                           | CHECK > 0 when set                                  |
| `Order.deliveryCheck` / `deliveryEtaDays`    | courier coverage at checkout: `SERVICEABLE`, `UNVERIFIED` (needs review), `SKIPPED`; courier estimate (days)         |                                                     |
| `Product.sourceRef`                          | origin of imported products (`woocommerce:<host>:<id>`), makes re-imports idempotent                                 | unique                                              |
| `Inventory.quantityReserved`                 | units held by active reservations                                                                                    | CHECK `0 ≤ reserved ≤ onHand`                       |
| `InventoryReservation`                       | per order line hold: `ACTIVE → CONSUMED \| RELEASED` (expiry = release), `expiresAt`                                 | idx (`status`,`expiresAt`), (`orderId`)             |
| `OrderStatus` (+7 values)                    | PAYMENT_FAILED, READY_TO_SHIP, OUT_FOR_DELIVERY, CANCELLATION_REQUESTED, RETURN_REQUESTED, RETURNED, REFUND_PENDING  | enum values added in place (non-destructive)        |
| `ReturnRequest`                              | cancellation/return request: type, status, reason, lines JSON, previous order status, resolution                     | idx (`orderId`), (`status`,`createdAt`)             |
| `PickupLocation`                             | warehouse / Shiprocket pickup nickname, origin PIN                                                                   | unique `providerName`                               |
| `Shipment` (extended)                        | provider, unique `reference`, provider ids, AWB, normalised + raw status, URLs, dims, `lastEventAt`, attempts, error | unique `reference`, unique `awb`                    |
| `ShipmentItem`                               | lines in a parcel                                                                                                    | unique (`shipmentId`,`orderItemId`)                 |
| `ShipmentEvent`                              | normalised tracking history                                                                                          | unique `dedupeKey`; idx (`shipmentId`,`occurredAt`) |
| `WebhookEvent`                               | inbound provider webhooks (non-payment)                                                                              | unique (`provider`,`dedupeKey`)                     |
| `Job`                                        | durable background job / transactional outbox                                                                        | unique `dedupeKey`; idx (`status`,`runAt`)          |
| `Notification` + `NotificationLog`           | queued customer/admin messages and delivery attempts                                                                 | idx (`status`,`createdAt`)                          |
| `SystemState`                                | key/value operational state (worker heartbeat, last sync)                                                            | PK `key`                                            |
| `StoreSettings` (+)                          | default package weight (g) and box (mm) — Phase 4; return window days — Phase 7                                      | CHECK > 0                                           |

All additions are **additive migrations** (new tables/columns with defaults, enum values added) — no data loss,
compatible with rolling deploys (old code ignores new columns).
