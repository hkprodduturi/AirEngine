# Examples Inventory & Usage Map

> Complete dependency audit of all 46 `.air` files in `examples/`.

## Summary

| Tier | Count | Lines | Test Coverage |
|------|-------|-------|---------------|
| Showcase (flagship) | 5 | 1,247 | 2 golden runs, 5/5 in complex-eval-corpus, 1 runtime QA |
| Fixture | 7 | 214 | All 7 in bench/snapshot/transpiler tests |
| Gallery | 14 | 2,049 | Gallery catalog entries, 5 in complex-eval-corpus |
| Template | 20 | 3,463 | Dynamic eval-local glob (first 5) |
| **Total** | **46** | **6,973** | |

---

## Showcase — Flagship (5 files)

| ID | File | Lines | Models | Test Coverage |
|----|------|-------|--------|---------------|
| photography-studio-premium | photography-studio-premium.air | 360 | 6 | Golden run (33 checks), runtime QA (SH8), complex-eval |
| crm-sales-pipeline | crm-sales-pipeline.air | 318 | 8 | generate-crm-seed.ts, stability-sweep |
| helpdesk | helpdesk.air | 137 | 4 | Golden run (32 checks), complex-eval, baseline tests, gap tests |
| projectflow | projectflow.air | 301 | 5 | 48+ backend tests, bench, snapshots, complex-eval, stability-sweep |
| ecommerce | ecommerce.air | 131 | 4 | complex-eval, online-eval, inject-showcase |

### Key Dependencies
- `benchmarks/complex-eval-corpus.json` — helpdesk, projectflow, ecommerce, clinic, crm, photography (6 fixtures)
- `scripts/helpdesk-golden-run.ts` — helpdesk (32 capability checks)
- `scripts/photography-premium-golden-run.ts` — photography (33 capability checks)
- `qa-flows/photography-public.json` — photography (SH8 runtime QA)
- `tests/complex-app-baseline.test.ts` — helpdesk
- `tests/helpdesk-golden.test.ts` — helpdesk (32 checks)
- `tests/stability-sweep.test.ts` — reads showcase-manifest.json

---

## Fixtures (7 files) — Internal Regression

| ID | File | Lines | Fullstack | Referenced By |
|----|------|-------|-----------|---------------|
| todo | todo.air | 11 | No | transpiler, snapshots, bench, mcp, backend, eval-local, foundation-check, generator, CI |
| expense-tracker | expense-tracker.air | 32 | No | transpiler, bench, backend, eval-local, generator |
| landing | landing.air | 31 | No | transpiler, bench, backend, eval-local, generator |
| auth | auth.air | 24 | Yes | transpiler, snapshots, bench, backend, mcp, eval-local |
| dashboard | dashboard.air | 37 | Yes | transpiler, bench, backend, mcp, eval-local, demo-canonical, generator |
| fullstack-todo | fullstack-todo.air | 20 | Yes | transpiler, snapshots, bench, backend, mcp, conformance, eval-local, demo-canonical, generator, CI |
| portfolio | portfolio.air | 59 | No | Gallery catalog only |

### Key Dependencies
- `tests/snapshots.test.ts` — todo, auth, fullstack-todo, projectflow, helpdesk (golden hashes)
- `tests/bench.test.ts` — all 7 core (200ms performance ceiling)
- `tests/conformance.test.ts` — fullstack-todo (cross-target conformance)
- `scripts/eval-local.ts` — all 7 (smoke, determinism, hashes)
- `scripts/demo-canonical.ts` — fullstack-todo (primary), dashboard (alternative)
- `src/generator.ts` — todo, fullstack-todo, landing, dashboard, expense-tracker (5 replay fixtures)
- `src/mcp/server.ts` — todo, expense-tracker, landing, auth, dashboard, fullstack-todo (MCP examples)
- `.github/workflows/ci.yml` — todo, fullstack-todo, projectflow (CI transpile tests)

---

## Gallery (14 files) — Catalog & Complex Eval

| ID | File | Lines | Notes |
|----|------|-------|-------|
| analytics | analytics.air | 171 | Gallery catalog |
| blog | blog.air | 126 | Gallery + inject-showcase |
| booking | booking.air | 138 | Gallery catalog |
| chat | chat.air | 103 | Gallery catalog |
| clinic | clinic.air | 159 | Gallery + complex-eval (reclassified from showcase) |
| crm | crm.air | 169 | Gallery + complex-eval (reclassified from showcase) |
| inventory | inventory.air | 146 | Gallery catalog (reclassified from showcase) |
| kanban | kanban.air | 109 | Gallery + inject-showcase |
| lms | lms.air | 137 | Gallery + inject-showcase |
| monitoring | monitoring.air | 168 | Gallery catalog (reclassified from showcase) |
| music | music.air | 136 | Gallery catalog |
| property-listing | property-listing.air | 168 | Gallery catalog |
| restaurant-pos | restaurant-pos.air | 165 | Gallery catalog |
| social-feed | social-feed.air | 126 | Gallery catalog |
| survey | survey.air | 128 | Gallery catalog |

All have `gallery/catalog.json` entries. Transpiler stability verified via stability sweep (for the 5 in showcase-manifest) or gallery sweep.

---

## Templates (20 files) — AI Generation Base

| ID | Lines |
|----|-------|
| base-ai-chat | 124 |
| base-analytics | 140 |
| base-command-center | 177 |
| base-crud-admin | 179 |
| base-doc-editor | 147 |
| base-feed | 217 |
| base-gantt | 206 |
| base-inbox | 150 |
| base-kanban | 144 |
| base-learning | 163 |
| base-ledger | 202 |
| base-marketplace | 144 |
| base-noc | 117 |
| base-patient-chart | 263 |
| base-portal | 220 |
| base-pos | 148 |
| base-scheduler | 141 |
| base-storefront | 225 |
| base-warehouse | 196 |
| base-wizard | 160 |

Only first 5 (alphabetically) tested by `scripts/eval-local.ts`. No individual test coverage.

---

## Cross-Reference Matrix

| Consumer | Fixture | Showcase | Gallery | Template |
|----------|---------|----------|---------|----------|
| tests/transpiler.test.ts | todo, auth, dashboard, landing, expense-tracker, fullstack-todo, projectflow | — | — | — |
| tests/backend.test.ts | todo, auth, dashboard, landing, expense-tracker, fullstack-todo, projectflow | — | — | — |
| tests/snapshots.test.ts | todo, auth, fullstack-todo | helpdesk, projectflow | — | — |
| tests/bench.test.ts | All 7 core | — | — | — |
| tests/mcp.test.ts | todo, auth, dashboard, fullstack-todo | — | — | — |
| tests/conformance.test.ts | fullstack-todo | — | — | — |
| tests/complex-app-*.test.ts | — | helpdesk | — | — |
| tests/helpdesk-golden.test.ts | — | helpdesk | — | — |
| tests/stability-sweep.test.ts | — | reads showcase-manifest.json | — | — |
| scripts/eval-local.ts | All 7 core | projectflow | — | First 5 base-* |
| scripts/demo-canonical.ts | fullstack-todo | — | — | — |
| scripts/helpdesk-golden-run.ts | — | helpdesk | — | — |
| scripts/photography-premium-golden-run.ts | — | photography | — | — |
| scripts/inject-showcase.ts | todo | ecommerce | blog, kanban, lms, clinic, crm | — |
| benchmarks/complex-eval-corpus.json | — | helpdesk, projectflow, ecommerce, photography | clinic, crm | — |
| gallery/catalog.json | All 7 core | All 5 showcase | All 14 gallery | — |
| src/generator.ts (replay) | todo, fullstack-todo, landing, dashboard, expense-tracker | — | — | — |
| src/mcp/server.ts | todo, expense-tracker, landing, auth, dashboard, fullstack-todo | — | — | — |
| CI (.github/workflows) | todo, fullstack-todo | projectflow | — | — |
