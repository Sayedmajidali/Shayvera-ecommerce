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
| Adapter request building / response parsing                                                                | unit-tested against payloads copied from the official examples                                                                                                                                                                                  |
| Workflows (create, duplicate, timeout, invalid response, outage, tracking, webhooks, stale events, cancel) | integration-tested with `MockShippingProvider` and an HTTP-level fake of the Shiprocket API                                                                                                                                                     |
| Real Shiprocket API                                                                                        | **unverified — awaiting business credentials**. Plan: create API user → set env → run `npm run shipping:verify` (auth + serviceability only, read-only) → one real test shipment created and immediately cancelled with the business's consent. |

## Parcel estimate (implemented in Phase 4)

`modules/shipping/package.ts` → `computeShipmentPackage(lines, defaultPackage)`: total weight = Σ quantity ×
(variant packed weight or store default); box = largest length and breadth of any unit, heights stacked; reports
`usedDefaults` when any line lacked its own package. `toCourierUnits()` converts to kg (rounded up to 10 g) and cm
(rounded up) for Shiprocket; `volumetricWeightGrams()` uses the 5000 cm³/kg divisor. Staff can override the parcel when
creating a shipment (Phase 9). Unit-tested; the Shiprocket calls that use it are Phase 9.
