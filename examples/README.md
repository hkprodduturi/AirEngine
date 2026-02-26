# AirEngine Examples

This directory contains 46 `.air` files organized into four tiers.

## Flagship Apps (Public Showcase)

These are production-quality, fullstack apps validated by golden runs, complex eval, and/or runtime QA. They are the primary public-facing examples.

| App | File | Lines | Models | Highlights |
|-----|------|-------|--------|------------|
| **Lumiere Studio** | `photography-studio-premium.air` | 360 | 6 | Portfolio CMS, inquiry pipeline, public pages + admin, SH8 runtime QA validated |
| **SalesPipe CRM** | `crm-sales-pipeline.air` | 318 | 8 | Deal pipeline, lead qualification, activity logging, 424-record seed |
| **ProjectFlow** | `projectflow.air` | 301 | 5 | All 16 block types, cron, webhooks, queues, email, deploy |
| **HelpDesk** | `helpdesk.air` | 137 | 4 | Ticket workflows, SLA tracking, reply threads, 32 golden checks |
| **E-Commerce** | `ecommerce.air` | 131 | 4 | Cart, orders, checkout, webhooks, inventory tracking |

Manifested in `showcase-manifest.json`. Tested by `npm run stability-sweep`.

## Internal Fixtures (Regression)

Small examples used extensively by the test suite, benchmarks, and CI. Not for public showcase.

| File | Lines | Purpose |
|------|-------|---------|
| `todo.air` | 11 | Simplest example, parser/transpiler unit tests |
| `fullstack-todo.air` | 20 | Primary canonical demo, conformance suite |
| `auth.air` | 24 | JWT auth pattern tests |
| `landing.air` | 31 | Multi-section layout tests |
| `expense-tracker.air` | 32 | Filtering + computed values tests |
| `dashboard.air` | 37 | Auth-gated dashboard tests |
| `portfolio.air` | 59 | Frontend-only portfolio |

## Gallery (14 apps)

Medium-complexity fullstack apps. Used by `gallery/catalog.json` and transpile smoke tests. Includes 4 apps reclassified from the former 8-app showcase (clinic, crm, inventory, monitoring).

## Templates (20 files)

`base-*` prefixed files used by the AI generation pipeline (`scripts/eval-local.ts`). Not individually tested.

## Manifests

| File | Purpose |
|------|---------|
| `showcase-manifest.json` | Public flagship apps (5 entries) — read by stability sweep |
| `fixtures-manifest.json` | Complete inventory of all 46 files with tier, usage, and dependencies |

## Running a Flagship App Locally

```bash
# 1. Transpile
npx tsx src/cli/index.ts transpile examples/photography-studio-premium.air -o ./output --no-incremental

# 2. Start client
cd output/client && npm install && npx vite --port 5173

# 3. Start server (in separate terminal)
cd output/server && npm install
echo 'DATABASE_URL="file:./dev.db"\nJWT_SECRET="dev-secret"\nSMTP_HOST="localhost"\nPORT=3001' > .env
npx prisma db push && npx prisma generate && npx tsx seed.ts
npx tsx server.ts
```

See [docs/run-flagship-apps-locally.md](../docs/run-flagship-apps-locally.md) for detailed instructions.
