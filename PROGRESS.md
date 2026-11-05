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
