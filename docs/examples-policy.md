# Examples Policy

> Classification rules for AirEngine's `examples/` directory.

## Tier System

| Tier | Purpose | Criteria | Manifest |
|------|---------|----------|----------|
| **showcase** | Public demos, marketing, gallery hero cards | 100+ lines, 3+ models, fullstack + auth, production-quality UI | `examples/showcase-manifest.json` |
| **fixture** | Regression tests, benchmarks, replay fixtures | Referenced by 3+ test/script files, stable golden hashes | `examples/fixtures-manifest.json` |
| **gallery** | Gallery catalog entries, transpile smoke tests | Has `gallery/catalog.json` entry, no dedicated test coverage | `examples/fixtures-manifest.json` |
| **template** | AI-first generation guidance, eval-local dynamic glob | `base-*` prefix, used dynamically by `scripts/eval-local.ts` | `examples/fixtures-manifest.json` |

## Rules

1. **Showcase = complex only.** Simple/medium examples (todo, landing, expense-tracker, auth, dashboard, fullstack-todo) are internal fixtures, not public showcase material.

2. **Adding a showcase example** requires:
   - 100+ lines of AIR
   - 3+ data models with relations
   - Fullstack with auth (`@db`, `@api`, `@auth`)
   - Entry in `examples/showcase-manifest.json`
   - Entry in `benchmarks/complex-eval-corpus.json` (replay fixture)
   - At minimum, passes stability sweep

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
| `examples/showcase-manifest.json` | Public, CI (stability sweep) | Complex apps only (8 entries) |
| `examples/fixtures-manifest.json` | Internal, tooling | All 46 files classified by tier |
| `gallery/catalog.json` | Website gallery | 25 non-base examples with metadata |
| `benchmarks/complex-eval-corpus.json` | Eval harness | 5 complex replay fixtures |

## Current Inventory (46 files)

- **8 showcase**: helpdesk, projectflow, ecommerce, crm-sales-pipeline, clinic, crm, inventory, monitoring
- **7 fixtures**: todo, expense-tracker, landing, auth, dashboard, fullstack-todo, portfolio
- **10 gallery**: analytics, blog, booking, chat, kanban, lms, music, property-listing, restaurant-pos, social-feed, survey
- **20 templates**: base-ai-chat through base-wizard
