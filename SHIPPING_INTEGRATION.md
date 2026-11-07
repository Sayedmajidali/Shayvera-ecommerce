# Shipping Integration — Shiprocket

Source: official Shiprocket API documentation (Postman collection `8407119/SzYW1zB2`, published at
apidocs.shiprocket.in), read 2026-11-06. Base URL `https://apiv2.shiprocket.in/v1/external`.
Module: `src/server/modules/shipping`.

## 1. Design

The order system talks only to an internal **`ShippingProvider`** interface:

| Operation                 | Shiprocket endpoint                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticate` (internal) | `POST /auth/login` {email, password} → `token` (Bearer); cached, refreshed on 401 / expiry (JWT `exp`)                                                                                                                                                                                    |
| `checkServiceability`     | `GET /courier/serviceability/?pickup_postcode&delivery_postcode&cod=0/1&weight(kg)&length&breadth&height&declared_value` → `data.available_courier_companies[]` (`courier_company_id`, `courier_name`, `rate`, `cod`, `estimated_delivery_days`, `etd`), `recommended_courier_company_id` |
| `createShipment`          | `POST /orders/create/adhoc` (order_id = our reference, pickup_location name, billing/shipping, order_items, payment_method `COD`/`Prepaid`, sub_total, dimensions cm, weight kg) → Shiprocket `order_id`, `shipment_id`                                                                   |
| `findShipmentByReference` | `GET /orders?search=<our reference>` (searches channel order id / AWB) — used before any retry of a create                                                                                                                                                                                |
| `assignAwb`               | `POST /courier/assign/awb` {shipment_id, courier_id?} → `response.data.awb_code`, `courier_name`, `pickup_scheduled_date`                                                                                                                                                                 |
| `schedulePickup`          | `POST /courier/generate/pickup` {shipment_id: [id], pickup_date?: [YYYY-MM-DD]}                                                                                                                                                                                                           |
| `generateLabel`           | `POST /courier/generate/label` {shipment_id: [id]} → `label_url`                                                                                                                                                                                                                          |
| `generateManifest`        | `POST /manifests/generate` {shipment_id: [id]} → `manifest_url` (after AWB + pickup)                                                                                                                                                                                                      |
| `track`                   | `GET /courier/track/awb/{awb}` → `tracking_data.shipment_status`, `shipment_track[]`, `shipment_track_activities[]`, `track_url`, `etd`                                                                                                                                                   |
| `cancelShipment`          | `POST /orders/cancel/shipment/awbs` {awbs: []} (before "Out for Pickup"); `POST /orders/cancel` {ids: [SR order id]} for orders without AWB                                                                                                                                               |
| `createReturn`            | `POST /orders/create/return` (pickup = customer, shipping = our warehouse)                                                                                                                                                                                                                |

Implementations: `ShiprocketProvider` (real HTTP), `MockShippingProvider` (deterministic, in-DB state, used in
development and tests). Selected by `SHIPPING_PROVIDER=shiprocket|mock|manual`. `manual` keeps v1 behaviour
(admin types carrier + AWB) for businesses not yet on Shiprocket.

Shiprocket-specific request/response shapes never leave `providers/shiprocket/*`.

## 2. Data model

- `PickupLocation` — our warehouse; `providerName` must equal the pickup location nickname in Shiprocket
  (Settings → Pickup Address); origin PIN for serviceability.
- `Shipment` — one per parcel: order, pickup location, provider, `reference` (unique, sent as Shiprocket
  `order_id`, e.g. `SHV26000123-1`), provider order/shipment ids, AWB, courier, normalised `status`, raw
  `providerStatus` + code, label/manifest URLs, pickup date, ETD, weight/dimensions, COD amount,
  `lastEventAt`, `attempts`, `lastError`.
- `ShipmentItem` — order lines (and quantities) in the parcel.
- `ShipmentEvent` — normalised history (status, raw status/code, activity, location, `occurredAt`, source
  `WEBHOOK|POLL|ADMIN|SYSTEM`, dedupe hash).
- `WebhookEvent` — every inbound provider webhook (provider, dedupe key, headers subset, payload, auth result,
  processing status/attempts/error).
  Payment collection (COD) stays on `Payment`; delivery on `Shipment`. They are never merged.

## 3. Status normalisation

Shiprocket codes (official table) → internal `ShipmentStatus`:

| Shiprocket                                                                                                | Internal                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1 AWB Assigned                                                                                            | AWB_ASSIGNED                                |
| 2 Label Generated, 5 Manifest Generated                                                                   | AWB_ASSIGNED (label/manifest flags set)     |
| 3 Pickup Scheduled/Generated, 4 Pickup Queued, 15 Pickup Rescheduled, 19 Out For Pickup, 27 Pickup Booked | PICKUP_SCHEDULED                            |
| 13 Pickup Error, 20 Pickup Exception                                                                      | PICKUP_SCHEDULED + exception flag           |
| 42 Picked Up                                                                                              | PICKED_UP                                   |
| 6 Shipped, 18 In Transit, 22 Delayed, 38 Reached at Destination Hub, 39 Misrouted                         | IN_TRANSIT                                  |
| 17 Out For Delivery                                                                                       | OUT_FOR_DELIVERY                            |
| 7 Delivered, 23 Partial Delivered, 26 Fulfilled                                                           | DELIVERED                                   |
| 21 Undelivered (NDR)                                                                                      | UNDELIVERED                                 |
| 9 RTO Initiated, 14 RTO Acknowledged, 40 RTO NDR, 41 RTO OFD                                              | RTO_INITIATED                               |
| 10 RTO Delivered                                                                                          | RTO_DELIVERED                               |
| 8 Canceled, 16 Cancellation Requested, 45 Cancelled before dispatched                                     | CANCELLED                                   |
| 12 Lost, 24 Destroyed, 44 Disposed Off                                                                    | LOST                                        |
| 25 Damaged                                                                                                | DAMAGED                                     |
| unknown code                                                                                              | keep current status, store raw, log warning |

Order status is then derived by an explicit rule table (e.g. PICKED_UP/IN_TRANSIT → order `SHIPPED`,
OUT_FOR_DELIVERY → `OUT_FOR_DELIVERY`, DELIVERED → `DELIVERED` (+ COD collected → payment `PAID`),
RTO_DELIVERED → `RETURNED`), only when the order transition is valid.

**Stale/out-of-order protection.** Each event carries `occurredAt` (webhook `current_timestamp`,
format `DD MM YYYY HH:mm:ss` IST). An event older than `Shipment.lastEventAt` is recorded in history but does
not change the current status; terminal states (DELIVERED, RTO_DELIVERED, CANCELLED, LOST) are never
overwritten by non-terminal ones.

## 4. Webhooks

Per official docs: configured in Shiprocket → Settings → API → Webhooks; `POST`, `application/json`;
optional **security token sent as `x-api-key`**; the URL **must not contain** `shiprocket`, `kartrocket`,
`sr` or `kr`; endpoint must answer 200.
Our endpoint: `POST /api/webhooks/courier` (checked against the forbidden substrings).
Handler: constant-time compare of `x-api-key` with `SHIPROCKET_WEBHOOK_TOKEN` (required in production) →
store `WebhookEvent` with dedupe key `sha256(awb|current_status_id|current_timestamp)` → apply DB-only status
update + `ShipmentEvent`s from `scans[]` → enqueue notifications → 200. Unknown AWB → stored, 200, flagged.

## 5. Idempotency & retries

- **Create shipment**: internal `Shipment` row is created first (`PENDING`) with a unique `reference`; the
  worker job transitions it with a compare-and-set to `CREATING`. On timeout/5xx the outcome is unknown, so
  the next attempt first calls `findShipmentByReference`; only if nothing exists is the create repeated.
  Shiprocket also rejects duplicate `order_id`s (422), which is treated as "already exists → look up".
- **AWB / pickup / label / manifest**: idempotent at our side (skipped when already recorded); retried with
  backoff + jitter on 429/5xx/timeouts; 4xx validation errors are not retried and surface to the admin.
- **Tracking sync**: scheduled job polls active shipments without recent webhook events (rate-limited).
- Concurrent "create shipment" clicks: unique `(orderId, active)` guard + compare-and-set → exactly one.

## 6. Checkout integration

At checkout (and on the cart page) the shipping PIN is validated (6 digits) and `checkServiceability` is called
with origin PIN, destination PIN, COD flag and estimated weight (variant weights or default package). Results
are cached for 6 hours (cache abstraction). Outcomes:

- not serviceable → checkout blocked with a clear message;
- serviceable but COD not available → COD option disabled;
- provider unavailable/timeout (3 s) → checkout continues with configured shipping fees; COD allowed per store
  rules; the order is flagged for serviceability review.
  Customer shipping charges remain store-configured (flat fee / free threshold / COD fee); courier cost is a
  business expense shown to admins when creating the shipment.

## 7. Admin workflow

Orders → "Create shipment" (choose package weight/dimensions, courier from serviceability list or
recommended) → AWB assigned → "Schedule pickup" → label & manifest download → tracking timeline. The Shipments
dashboard lists pending shipments, creation failures (with retry), AWB/pickup status, in transit, out for
delivery, delivered, RTO, returns.

## 8. Configuration

| Variable                                           | Purpose                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `SHIPPING_PROVIDER`                                | `shiprocket`, `mock` or `manual`                                                  |
| `SHIPROCKET_API_EMAIL` / `SHIPROCKET_API_PASSWORD` | **API user** (Settings → API → Add New API User; must differ from the main login) |
| `SHIPROCKET_WEBHOOK_TOKEN`                         | the security token entered in Shiprocket's webhook settings                       |
| `SHIPROCKET_BASE_URL`                              | default `https://apiv2.shiprocket.in/v1/external`                                 |
| `SHIPPING_HTTP_TIMEOUT_MS`                         | default 10000                                                                     |

## 9. Verification status

**Shiprocket has no sandbox** — the official docs state that requests with valid credentials affect real data
in the Shiprocket account.

| Item                                                                                                       | Status                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint paths, payloads, status codes, webhook format                                                     | implemented from the official collection (2026-11-06)                                                                                                                                                                                           |
| Adapter request building / response parsing                                                                | unit-tested against the official example payloads: auth + serviceability (Phase 6); create/return body building, create/search/AWB/tracking parsing, IST timestamps, status mapping (Phase 9)                                                   |
| Workflows (create, duplicate, timeout, invalid response, outage, tracking, webhooks, stale events, cancel) | integration-tested with `MockShippingProvider` (failure injection: timeout after create, 422 duplicate, definite refusal); admin booking → webhook → customer page E2E-tested with the mock courier                                             |
| Real Shiprocket API                                                                                        | **unverified — awaiting business credentials**. Plan: create API user → set env → run `npm run shipping:verify` (auth + serviceability only, read-only) → one real test shipment created and immediately cancelled with the business's consent. |

## Parcel estimate (implemented in Phase 4)

`modules/shipping/package.ts` → `computeShipmentPackage(lines, defaultPackage)`: total weight = Σ quantity ×
(variant packed weight or store default); box = largest length and breadth of any unit, heights stacked; reports
`usedDefaults` when any line lacked its own package. `toCourierUnits()` converts to kg (rounded up to 10 g) and cm
(rounded up) for Shiprocket; `volumetricWeightGrams()` uses the 5000 cm³/kg divisor. Staff can override the parcel when
creating a shipment (Phase 9). Unit-tested; the Shiprocket calls that use it are Phase 9.

## Checkout serviceability (implemented in Phase 6)

- `modules/shipping/types.ts` (provider contract), `providers/mock.ts`, `providers/manual.ts`,
  `providers/shiprocket/{client,provider}.ts`, `serviceability.ts` (checkout service), `provider.ts` (selection).
- **Shiprocket adapter**: `POST /auth/login` → JWT (documented validity 10 days) cached in memory, refreshed an hour
  before `exp`, one shared login for concurrent callers, one forced re-login on 401. `GET /courier/serviceability/`
  with `pickup_postcode`, `delivery_postcode`, `cod=0` (every courier listed with its own `cod` flag), `weight` (kg),
  `length/breadth/height` (cm), `declared_value` (rupees). Parsed fields: `courier_company_id`, `courier_name`,
  `rate`, `cod`, `estimated_delivery_days`, `blocked` (blocked couriers ignored), `recommended_courier_company_id`.
- **Only a successful response with no couriers means "not serviceable".** The official collection does not document
  the error shape for unserviceable PINs, so any other response (4xx/5xx, unexpected JSON, timeout) is treated as
  **unverified** — checkout is never blocked by an integration problem.
- **Checkout**: the check runs before the order transaction with a 3 s budget; results (not failures) are cached 6 h
  per provider/origin/destination/500 g weight bucket. Not serviceable → 422 with a field error on the PIN; COD chosen
  where no courier offers COD → 422 on the payment method; unverified → order placed with
  `Order.deliveryCheck = UNVERIFIED`, shown as a warning on the admin order page and included in "Needs attention";
  `SKIPPED` for manual shipping or when the store PIN code (Admin → Settings) is not set. The order stores the courier
  estimate (`deliveryEtaDays`). Customer shipping charges stay store-configured; courier rates are never sent to the
  browser.
- **Checkout page**: `GET /api/shipping/serviceability?pincode=…[&buy=&qty=]` (rate limited) as the PIN is typed —
  "Delivers to 560034 in about 2 days", "COD isn't available here" (COD option disabled), or "we don't deliver to …"
  (Place order disabled).
- **Mock provider rules** (development/tests): PINs starting with 9 (Army/Field post) not serviceable; 79xxxx
  prepaid-only; 2 / 4 / 6 days for same region / same zone / elsewhere.
- **Real-account check**: `npm run shipping:verify -- --from <store PIN> --to <PIN>` logs in and requests one quote —
  read-only, creates nothing.

## Shipment module (implemented in Phase 9)

As built — differences from the design above are noted.

- **Schema**: `ShipmentStatus` has 18 values (PENDING, CREATING, CREATED, AWB_ASSIGNED, PICKUP_SCHEDULED, PICKED_UP,
  SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, UNDELIVERED, RTO_INITIATED, RTO_DELIVERED, RETURNED, CANCELLED,
  LOST, DAMAGED, FAILED). `Shipment` gained provider, unique `reference`, `isReturn`, pickup location, provider
  order/shipment ids, raw status + code, label/manifest URLs, pickup date, ETD, parcel, COD amount, `lastEventAt`,
  `attempts`, `lastError`, `needsAttention`. New `ShipmentEvent`, `PickupLocation` (its `name` is the Shiprocket pickup
  nickname) and `WebhookEvent`. **Not built**: `ShipmentItem` (one parcel per order holds every line; split parcels
  are not supported yet) and webhook header/auth-result columns (rejected webhooks are logged, not stored).
- **Database guards**: partial unique index — at most one active (not CANCELLED/FAILED) courier delivery shipment per
  order; at most one default pickup location; CHECK constraints on parcel and COD values.
- **Booking** (`requestShipment` → job `shipping.create`): the `PENDING` row and the job are written in one
  transaction; a concurrent second click hits the unique index → 409. The job compare-and-sets to `CREATING`; on a
  retry it first searches Shiprocket by reference; a 422 duplicate is looked up instead of re-created; then AWB
  (chosen courier or recommended) → `AWB_ASSIGNED`, order → `READY_TO_SHIP` (stock deducted), label fetched best-effort.
  A definite refusal (4xx) → `FAILED` + needs attention + error shown to staff (Retry button); unknown outcomes
  (timeout/5xx) are retried by the queue with backoff, never blindly re-created.
- **Pickup / documents**: schedule pickup (optional date; "already scheduled" responses count as success) and fetch
  the manifest; label/manifest URLs are fetched on demand and stored.
- **Tracking**: webhook `POST /api/webhooks/courier` (x-api-key, timing-safe, required in production, 256 KB cap) →
  `WebhookEvent` (dedupe `sha256(awb|shipment_status_id|current_timestamp)`) + job `shipping.webhook` → 200.
  `applyTrackingUpdate` locks the shipment row, always records the scan, ignores stale events and never leaves a
  terminal state; unknown codes are stored and flag the shipment; LOST/DAMAGED/RTO flag it too. Order status follows
  via the shipment→order table, stepping through SHIPPED when a pickup scan was missed; DELIVERED marks COD paid.
  Unknown AWBs are stored, answered 200 and listed on the Shipments dashboard. `shipping.sync-tracking` polls active
  shipments every 30 minutes.
- **Cancellation**: staff cancel a booking before pickup (409 after); cancelling an order (including an approved
  customer cancellation) enqueues `shipping.cancel` for its active courier bookings automatically. A manual shipment
  record still has to be cancelled with the courier by staff.
- **Returns**: for an approved return request staff can book a reverse pickup (`POST /orders/create/return`,
  reference `SHV…-R1`), from the customer's address to the pickup location. Refunds and restocking still follow the
  Phase 7 "Mark items received" step — nothing is refunded or restocked automatically.
- **Admin UI**: order page Shipping panel (book with courier quotes and parcel override, label, schedule pickup,
  manifest, refresh, cancel, retry, scan history); "Book return pickup" on approved returns; pickup location card in
  Settings; Shipments dashboard (`/admin/shipments`, `SHIPPING_MANAGE`) with tiles, needs-attention queue with retry,
  unmatched courier updates and a filterable list. With `SHIPPING_PROVIDER=manual` the v1 "Add shipment" form is
  kept and the booking buttons are hidden.
- **Customer UI**: order and tracking pages show the live delivery shipment only (no return pickups or cancelled
  bookings), a softened status ("Packed, waiting for courier pickup", "Delayed, our team is looking into it"), courier,
  AWB, expected delivery date and the scan history (status, place, time).
- **Mock courier**: in-memory, AWB `MOCK<shipmentId>`, 422 on duplicate reference, documents served by
  `/api/shipping/mock-document` (refused when the provider is not `mock`).

**Go-live checklist (needs the business):** create the Shiprocket API user and the pickup address (nickname = the
name entered in Admin → Settings → Pickup location) → set `SHIPPING_PROVIDER=shiprocket`, credentials and
`SHIPROCKET_WEBHOOK_TOKEN` → configure the webhook URL `https://<domain>/api/webhooks/courier` with that token →
`npm run shipping:verify` → with the business's consent, book one real shipment and cancel it immediately, checking
AWB, label and the cancellation webhook.
