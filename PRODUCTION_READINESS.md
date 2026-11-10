# Production Readiness

Assessment date: 2026-11-07 · Branch `claude/festive-franklin-tg5y03` (end of v2 Phase 15).

## 1. Verdict

**Development-complete. Not approved for production launch.**

The application meets the specification's development acceptance criteria (§2), with automated evidence
(`QA_REPORT.md`). It has **not** been run against the real Razorpay or Shiprocket APIs, a real SMTP service,
real object storage, or a Docker host, and no production infrastructure exists yet. Those verifications, plus the
business inputs in §9, must be completed and signed off in a separate launch review (§10). This document does
not claim production readiness beyond what the evidence shows.

| Category                | Status                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented and tested  | All customer, admin and engineering features in §2 (unit 185 · integration 254 · E2E 60, coverage ≈ 85 % lines)                               |
| Tested with mocks only  | Razorpay (simulator + fake SDK), Shiprocket (mock courier + HTTP fake), SMTP (local fake server), S3 (fake server + AWS signing test vectors) |
| Not yet verified        | Real Razorpay test-mode round trip; real Shiprocket API; real SMTP/S3 providers; Docker image build; load at real traffic                     |
| Not built (by decision) | Hosting/VPS, domain, TLS certificates, managed DB, monitoring accounts — out of scope until deployment (PROJECT_PLAN §5)                      |

## 2. Acceptance criteria (specification §23)

✅ done with automated evidence · ⚠️ done, needs real-provider verification · ❌ not done

### Customer

| Criterion                                   | Status  | Evidence                                                                     |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| Functional storefront, search and filtering | ✅      | `customer.spec.ts`, `storefront.test.ts`, axe scans                          |
| Product details                             | ✅      | product page E2E (specifications, structured data)                           |
| Cart, checkout                              | ✅      | `cart.test.ts`, `checkout.test.ts`, E2E desktop + phone                      |
| Customer accounts, order history            | ✅      | `auth.test.ts`, `customer.spec.ts`, account axe scans                        |
| Shipment tracking                           | ✅ / ⚠️ | `shipping.spec.ts`, `storefront-v2.spec.ts` — real courier events unverified |

### Admin

| Criterion                                              | Status  | Evidence                                                                       |
| ------------------------------------------------------ | ------- | ------------------------------------------------------------------------------ |
| Dashboard, reports (incl. GST register, CSV)           | ✅      | `reports.test.ts`, `dashboards.test.ts`, `reports.spec.ts`, `perf:check`       |
| Product, category, inventory management                | ✅      | `catalog.test.ts`, `inventory.test.ts`, `concurrency.test.ts`, `admin.spec.ts` |
| Order, customer, coupon management                     | ✅      | `admin.test.ts`, `order-lifecycle.test.ts`, `admin.spec.ts`                    |
| Payment management                                     | ✅      | `payments*.test.ts`, payments dashboard E2E                                    |
| Shipping management                                    | ✅ / ⚠️ | `shipping.test.ts`, `shipping.spec.ts` — against the mock courier              |
| Returns and refunds (credit notes)                     | ✅      | `returns-notifications.test.ts`, `requests.spec.ts`                            |
| Staff roles, audit log, background jobs, system status | ✅      | `rbac.test.ts`, `security-sweeps.test.ts`, `reports.spec.ts`                   |

### Integrations

| Criterion                                                         | Status | Notes                                                                                                  |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Razorpay test integration verified                                | ⚠️     | Code complete and tested with simulator and fake SDK. **Real test-mode run pending `rzp_test_` keys.** |
| Shiprocket verified, or clearly marked awaiting verification      | ⚠️     | **Awaiting provider verification** — Shiprocket has no sandbox (SHIPPING_INTEGRATION.md §9).           |
| Webhook processing, idempotency, failure handling, reconciliation | ✅     | Fast-ack + queued processing, dedupe keys, unknown-outcome reconciliation (SECURITY_REVIEW.md §5)      |

### Engineering

| Criterion                                         | Status | Evidence                                                                      |
| ------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| Secure authentication, server-side authorization  | ✅     | `auth.test.ts`, `rbac.test.ts`, `security-sweeps.test.ts`, SECURITY_REVIEW.md |
| Reliable transactions, concurrency-safe inventory | ✅     | `concurrency.test.ts`, `checkout.test.ts` (8 buyers / 3 units)                |
| Proper order lifecycle                            | ✅     | `order-status.test.ts`, `order-lifecycle.test.ts`                             |
| Structured logging                                | ✅     | JSON logs with request/job ids and redaction (ARCHITECTURE.md §8)             |
| Automated tests                                   | ✅     | 499 tests, coverage floors, 3× / 2× stability runs                            |
| Responsive design                                 | ✅     | `responsive.spec.ts` (Pixel 7: navigation, filters, checkout)                 |
| Performance optimisation                          | ✅     | indexes + `perf:check` at 200k orders; JS/TTFB budgets                        |
| Complete documentation                            | ✅     | the eleven documents listed in specification §22                              |

### Production readiness (documentation)

| Criterion                                    | Where                       |
| -------------------------------------------- | --------------------------- |
| Production configuration documented          | §3, `.env.example`, README  |
| External credentials configurable            | §3 (all via environment)    |
| Persistent storage strategy documented       | §5                          |
| Deployment architecture documented           | §4                          |
| Database backup and recovery plan documented | §6 (scripts + tested drill) |
| Monitoring and alerting plan documented      | §7                          |
| Security review completed                    | SECURITY_REVIEW.md          |
| Payment and shipping webhook requirements    | §8                          |

## 3. Production configuration

All configuration is environment variables, validated at start-up (`src/lib/env.ts`); invalid combinations stop
the process. Full list with defaults: `.env.example` and README → Environment variables.

| Variable(s)                                                     | Production value                                                      | Secret                |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------- |
| `NODE_ENV`                                                      | `production`                                                          |                       |
| `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`                        | `https://<domain>`                                                    |                       |
| `DATABASE_URL`                                                  | managed PostgreSQL, TLS (`sslmode=require`), runtime role (§6)        | yes                   |
| `BETTER_AUTH_SECRET`                                            | new 32+ byte random value (never reuse development's)                 | yes                   |
| `PAYMENT_GATEWAY=razorpay`, `RAZORPAY_KEY_ID/SECRET`            | live keys after test-mode verification                                | yes                   |
| `RAZORPAY_WEBHOOK_SECRET`                                       | secret set on the Razorpay webhook                                    | yes                   |
| `SHIPPING_PROVIDER=shiprocket`, `SHIPROCKET_API_EMAIL/PASSWORD` | Shiprocket API user                                                   | yes                   |
| `SHIPROCKET_WEBHOOK_TOKEN`                                      | random token, also entered in Shiprocket (required in production)     | yes                   |
| `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID` | DLT-registered sender id + approved OTP template (TRAI rules)         | yes                   |
| `EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`                 | transactional email service, verified sender domain (SPF/DKIM/DMARC)  | yes                   |
| `STORAGE_DRIVER=s3`, `S3_*`                                     | private bucket; app serves `/media/*`                                 | yes                   |
| `JOB_RUNNER=worker`                                             | default in production; run the worker process (§4)                    |                       |
| `TRUSTED_PROXY_HOPS`                                            | number of proxies in front of the app (1 with a single reverse proxy) |                       |
| `MONITORING_WEBHOOK_URL`, `SLOW_REQUEST_MS`, `LOG_LEVEL`        | alert relay URL; 1500; `info`                                         | URL may embed a token |

Secrets belong in the hosting provider's secret store (or an `.env.production` readable only by the service user),
never in the repository or the image. The app refuses the payment simulator in production; Admin → Background jobs
→ System status shows every integration's mode without revealing values.

## 4. Deployment architecture

```
Internet ──HTTPS──▶ Reverse proxy / load balancer (TLS, HTTP→HTTPS, body limits)
                         │
                         ▼
               Web: Next.js standalone (N instances, stateless)  ──▶  PostgreSQL (managed, TLS, PITR)
                         │                                      ▲
               Worker: npm run worker (1+ instances) ───────────┘   jobs claimed with SKIP LOCKED
                         │
             S3-compatible object storage · SMTP service · Razorpay · Shiprocket · alert webhook
```

- **Images**: `Dockerfile` targets `web` (standalone server) and `worker` (also runs migrations).
  `docker-compose.prod.yml` is a single-host, production-like stack (db, migrate, web, worker) for staging and
  smoke tests. `deploy/Caddyfile.example` is a reverse-proxy example with automatic HTTPS. `deploy/VPS_DEPLOYMENT.md` is the step-by-step single-VPS guide. The images and compose stack were built and smoke-tested with Docker (migrate, seed, admin, sign-in, uploads, restart persistence); TLS/DNS were not. Before this, none of this had been
  run in the build sandbox (no Docker daemon); the first deployment must start with a staging smoke test.
- **Release steps**: build the image → run `prisma migrate deploy` (the `migrate` service) → start/roll web and
  worker → check `GET /api/health` and System status.
- **Horizontal scaling**: web instances share no memory state. Sessions, rate limits, the job queue, webhook
  dedupe and sequences are in PostgreSQL; files go to object storage with `STORAGE_DRIVER=s3`. Per-instance
  memory is limited to the serviceability cache (6 h TTL; staleness only affects delivery estimates) and the
  Shiprocket login token (each instance logs in itself). Workers can scale out (`FOR UPDATE SKIP LOCKED`);
  scheduled jobs are deduplicated per window. **Local storage is single-instance only** (System status warns in
  production).
- **Health**: `GET /api/health` → 503 only if the database is unreachable; reports queue backlog and worker
  heartbeat as `degraded` (200) so the balancer keeps routing while operators are alerted.
- **Rollback**: migrations are additive (expand/contract: new columns nullable or defaulted, no destructive
  changes without an explicit, reviewed migration), so the previous image runs against the new schema; roll back by
  redeploying the previous image tag. Restore from backup only for data corruption (§6).
- **Network**: PostgreSQL reachable only from the app network; the app listens on localhost/private network
  behind the proxy; outbound HTTPS to Razorpay, Shiprocket, SMTP, storage and the alert webhook.

## 5. Persistent storage strategy

| Data                    | Store                                      | Durability                                                                                                                                 |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Business data           | PostgreSQL                                 | managed backups + PITR, plus logical dumps (§6)                                                                                            |
| Product/brand images    | S3-compatible bucket (`STORAGE_DRIVER=s3`) | provider durability; enable versioning; images keyed by random ids, served with immutable cache headers (put a CDN in front of `/media/*`) |
| Invoices / credit notes | immutable JSON snapshots in PostgreSQL     | rendered on request; backed up with the database                                                                                           |
| Logs                    | stdout → hosting log pipeline              | retention set by the log platform (suggest 30–90 days)                                                                                     |

The S3 provider is implemented without an SDK (`src/server/platform/storage/s3.ts`, AWS Signature V4 verified
against the official AWS test vectors) and works with AWS S3, Cloudflare R2, DigitalOcean Spaces and MinIO.
Moving existing local uploads: copy `storage/uploads/*` to the bucket with the same keys, then switch the driver.

## 6. Database: backups, recovery, pooling, roles

- **Backups**: enable the managed provider's automated backups with point-in-time recovery (WAL), retention ≥ 7
  days. In addition, `scripts/ops/db-backup.sh` writes daily logical dumps (`pg_dump` custom format + SHA-256,
  keeps 14) from a machine other than the database host; copy them to versioned object storage in another region.
- **Recovery drill (done 2026-11-07, local)**: dump → restore into a new database with
  `scripts/ops/db-restore.sh` → row counts and migration history matched, `prisma migrate status` up to date;
  the restore script refuses non-empty databases. Repeat quarterly in staging and record RPO/RTO.
- **Targets (proposal)**: RPO ≤ 15 minutes (PITR), RTO ≤ 2 hours.
- **Connection pooling**: Prisma keeps a pool per process (`connection_limit` in `DATABASE_URL`; default
  `num_cpus × 2 + 1`). Keep `instances × connection_limit` below the database's limit. With PgBouncer in
  transaction mode add `?pgbouncer=true` and give migrations a direct (non-pooled) URL.
- **Least privilege**: a migration role (DDL) used only by the release step, and a runtime role limited to DML on
  the application schema.
- **Migrations**: `npx prisma migrate deploy` only (never `migrate dev`/`reset` against production). All v2
  migrations are additive; partial indexes and CHECK constraints are part of the migrations.

## 7. Monitoring and alerting plan

| Signal                                                   | Source                                                               | Alert when                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| Uptime / database                                        | `GET /api/health` (external uptime check, 1 min)                     | non-200 for 2 checks                       |
| Worker heartbeat, job backlog                            | health `jobs.worker`, `oldestDueAgeMs`                               | `stale` or backlog > 15 min                |
| Dead jobs                                                | Admin → Background jobs; dashboard alert                             | any (daily review), > 5 (page)             |
| Unhandled errors (API, pages, worker)                    | logs + `MONITORING_WEBHOOK_URL`                                      | any new error type; > 10/min               |
| Payment failures / unprocessed webhooks / failed refunds | logs (`category: integration`), dashboard alerts, staff alert emails | webhook unprocessed > 5 min; refund failed |
| Courier failures / unknown statuses / RTO                | staff alert emails, Shipments dashboard                              | any                                        |
| Slow requests                                            | `Slow API request` warnings                                          | p95 > 1.5 s for 10 min                     |
| Low stock                                                | daily staff digest                                                   | —                                          |
| Backups                                                  | backup job exit status                                               | missing or failed run                      |

Logs are JSON with request/job ids and redaction of secrets and contact details. A Sentry-style SDK can replace the
webhook reporter through `registerErrorReporter` without touching call sites.

## 8. Webhook deployment requirements

| Provider   | URL                                      | Configure                                                                                                                                                                      | Verification on our side                                      |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Razorpay   | `https://<domain>/api/webhooks/razorpay` | Dashboard → Webhooks; events `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`; secret = `RAZORPAY_WEBHOOK_SECRET` | HMAC over the raw body; rotation via `…_PREVIOUS`; 256 KB cap |
| Shiprocket | `https://<domain>/api/webhooks/courier`  | Settings → API → Webhooks; security token = `SHIPROCKET_WEBHOOK_TOKEN` (sent as `x-api-key`). URL must not contain "shiprocket", "kartrocket", "sr" or "kr"                    | constant-time token check; dedupe; 256 KB cap                 |

Both need public HTTPS, must not be behind authentication or a WAF rule that alters the body, and must answer
quickly (they do: store + enqueue). After registering, send a test event and confirm it in Admin → Payments /
Shipments and Background jobs.

## 9. Before launch: required inputs and verifications

**Business inputs:** registered legal name, GSTIN (if registered) and FSSAI licence number; support email/phone and
address; real product prices, pack sizes, HSN codes and GST rates; pickup (warehouse) address and PIN; sender email
domain; return/refund policy confirmation; reviewed legal pages.

**Verifications (in order):**

1. Staging deployment from the Docker images with production-like settings; health and System status green.
2. Razorpay **test mode**: run the README checklist (success, failure, interrupted payment, refund, webhook with
   secret) and record the results in PAYMENT_INTEGRATION.md §8.
3. Shiprocket: `npm run shipping:verify`; then, with the business's consent, one real booking → label → cancel,
   and a webhook test event (SHIPPING_INTEGRATION.md go-live checklist).
4. SMS: with MSG91 configured, request a sign-in code to two real numbers (different operators) and confirm
   delivery time and template text. The MSG91 integration is written to its Flow API but **unverified against the
   live service** (no account during development).
5. SMTP: password reset and an order confirmation delivered to Gmail/Outlook (SPF/DKIM pass).
6. Object storage: upload an image, open it through `/media/…` from two web instances.
7. Backups: automated backups on; restore drill in staging.
8. Security: items in SECURITY_REVIEW.md §4 accepted or fixed (staff MFA, shorter staff sessions,
   `TRUSTED_PROXY_HOPS`, CSP review); professional penetration test before real payments.
9. Load test of browse → checkout at expected peak (e.g. k6) against staging.
10. Switch Razorpay to live keys only after 1–9; place and refund a real low-value order.

## 10. Launch review checklist (when deployment begins — specification §20)

| Topic                    | Decision / check                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure sizing    | start: 2 web × 1 vCPU/1 GB, 1 worker, managed PostgreSQL 2 vCPU/4 GB; revisit after load test (`perf:check` shows reports < 0.5 s at 200k orders)                |
| Database backup strategy | §6                                                                                                                                                               |
| Monitoring               | §7; external uptime check + alert webhook configured                                                                                                             |
| Secrets                  | §3; secret store; rotation plan for auth, Razorpay webhook, Shiprocket token, SMTP, S3 keys                                                                      |
| Rate limiting            | DB-backed limits active; `TRUSTED_PROXY_HOPS` matches the proxy chain; optional edge rate limits                                                                 |
| Payment webhook URL      | §8                                                                                                                                                               |
| Shiprocket webhook URL   | §8                                                                                                                                                               |
| Email provider           | SMTP service chosen; domain authentication                                                                                                                       |
| Storage provider         | bucket created, private, versioned; CDN in front of `/media/*`                                                                                                   |
| SSL                      | managed certificates (proxy/load balancer), HSTS enabled automatically on HTTPS                                                                                  |
| Firewall                 | only 80/443 public; DB private; SSH restricted                                                                                                                   |
| DB connection pooling    | §6                                                                                                                                                               |
| Operational recovery     | runbook: restore (§6), rollback (§4), dead-job retry and webhook retry (admin), provider outages (orders continue; courier bookings and refunds retry/reconcile) |

Launch approval requires sign-off on §9 and §10 by the business owner; development completion alone is not
launch approval.
