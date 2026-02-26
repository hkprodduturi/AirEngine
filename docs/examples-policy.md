# Examples Policy

> Classification rules for AirEngine's `examples/` directory.

## Tier System

| Tier | Purpose | Criteria | Manifest |
|------|---------|----------|----------|
| **showcase** | Public flagship demos, README hero apps | 100+ lines, 3+ models, fullstack + auth, golden-run or complex-eval coverage | `examples/showcase-manifest.json` |
| **fixture** | Regression tests, benchmarks, replay fixtures | Referenced by 3+ test/script files, stable golden hashes | `examples/fixtures-manifest.json` |
| **gallery** | Gallery catalog entries, complex-eval corpus, transpile smoke tests | Has `gallery/catalog.json` entry, no dedicated golden run | `examples/fixtures-manifest.json` |
| **template** | AI-first generation guidance, eval-local dynamic glob | `base-*` prefix, used dynamically by `scripts/eval-local.ts` | `examples/fixtures-manifest.json` |

## Rules

1. **Showcase = flagship only.** Only apps that are golden-run validated, complex-eval tested, or runtime QA validated belong in the public showcase. Current flagship apps (5):
   - `photography-studio-premium.air` — 33 golden checks, SH8 runtime QA
   - `crm-sales-pipeline.air` — 8 models, 424-record seed
   - `helpdesk.air` — 32 golden checks, complex eval
   - `projectflow.air` — all 16 blocks, 48+ backend tests
   - `ecommerce.air` — complex eval, webhook patterns

2. **Adding a showcase example** requires:
   - 100+ lines of AIR
   - 3+ data models with relations
   - Fullstack with auth (`@db`, `@api`, `@auth`)
   - Entry in `examples/showcase-manifest.json`
   - Entry in `benchmarks/complex-eval-corpus.json` (replay fixture)
   - At minimum, passes stability sweep
   - Preferably has golden run or runtime QA coverage

3. **Adding a fixture** requires:
   - Entry in `examples/fixtures-manifest.json`
   - Referenced by at least one test or script
   - Golden hash in `tests/__snapshots__/golden.json` (for core fixtures)

4. **Templates** (`base-*` files):
   - Used dynamically by `scripts/eval-local.ts` (first 5 by alphabetical order)
   - No individual test coverage; transpiler regression is caught by core fixtures
   - New templates do not need test entries

5. **No file moves/deletions** without verifying all 8 gates pass:
   - `npx tsc --noEmit`
   - `npx vitest run`
   - `npm run quality-gate -- --mode offline`
   - `npm run helpdesk-golden`
   - `npm run eval-complex`
   - `npm run stability-sweep -- --mode offline`
   - `npm run foundation-check`
   - `npm run demo-canonical`

## Manifest Files

| File | Audience | Content |
|------|----------|---------|
| `examples/showcase-manifest.json` | Public, CI (stability sweep) | Flagship apps only (5 entries) |
| `examples/fixtures-manifest.json` | Internal, tooling | All 46 files classified by tier |
| `gallery/catalog.json` | Website gallery | 25 non-base examples with metadata |
| `benchmarks/complex-eval-corpus.json` | Eval harness | 6 complex replay fixtures |

## Current Inventory (46 files)

- **5 showcase** (flagship): photography-studio-premium, crm-sales-pipeline, helpdesk, projectflow, ecommerce
- **7 fixtures** (internal regression): todo, expense-tracker, landing, auth, dashboard, fullstack-todo, portfolio
- **14 gallery** (catalog + demoted showcase): analytics, blog, booking, chat, clinic, crm, inventory, kanban, lms, monitoring, music, property-listing, restaurant-pos, social-feed, survey
- **20 templates** (AI generation base): base-ai-chat through base-wizard
