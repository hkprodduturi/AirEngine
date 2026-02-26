# Examples Inventory & Usage Map

> Complete dependency audit of all 46 `.air` files in `examples/`.

## Summary

| Tier | Count | Lines | Test Coverage |
|------|-------|-------|---------------|
| Showcase | 8 | 1,629 | 5/8 in complex-eval-corpus, 1 golden run |
| Fixture | 7 | 214 | All 7 in bench/snapshot/transpiler tests |
| Gallery | 10 | 1,407 | Gallery catalog entries only |
| Template | 20 | 3,463 | Dynamic eval-local glob (first 5) |
| **Total** | **46** | **6,713** | |

---

## Showcase (8 files) — Public Demos

| ID | File | Lines | Models | Test Coverage |
|----|------|-------|--------|---------------|
| helpdesk | helpdesk.air | 137 | 4 | Golden run (32/32), complex-eval, complex-app-baseline, complex-app-gaps |
| projectflow | projectflow.air | 301 | 5 | 48+ backend tests, bench, snapshots, complex-eval, stability-sweep |
| ecommerce | ecommerce.air | 131 | 4 | complex-eval, online-eval, inject-showcase |
| crm-sales-pipeline | crm-sales-pipeline.air | 318 | 8 | generate-crm-seed.ts |
| clinic | clinic.air | 159 | 4 | complex-eval |
| crm | crm.air | 169 | 4 | complex-eval |
| inventory | inventory.air | 146 | 5 | Gallery catalog only |
| monitoring | monitoring.air | 168 | 4 | Gallery catalog only |

### Key Dependencies
- `benchmarks/complex-eval-corpus.json` — helpdesk, projectflow, ecommerce, clinic, crm (5 replay fixtures)
- `scripts/helpdesk-golden-run.ts` — helpdesk (primary flagship)
- `tests/complex-app-baseline.test.ts` — helpdesk
- `tests/helpdesk-golden.test.ts` — helpdesk (32 capability checks)
- `gallery/catalog.json` — all 8 have entries (crm-sales-pipeline pending)

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

## Gallery (10 files) — Catalog Entries

| ID | File | Lines | inject-showcase |
|----|------|-------|-----------------|
| analytics | analytics.air | 171 | No |
| blog | blog.air | 126 | Yes |
| booking | booking.air | 138 | No |
| chat | chat.air | 103 | No |
| kanban | kanban.air | 109 | Yes |
| lms | lms.air | 137 | Yes |
| music | music.air | 136 | No |
| property-listing | property-listing.air | 168 | No |
| restaurant-pos | restaurant-pos.air | 165 | No |
| social-feed | social-feed.air | 126 | No |
| survey | survey.air | 128 | No |

All have `gallery/catalog.json` entries. No dedicated test files. Transpiler stability verified only via stability sweep.

---

## Templates (20 files) — AI Generation Base

| ID | Lines | Doc Refs |
|----|-------|----------|
| base-ai-chat | 124 | — |
| base-analytics | 140 | — |
| base-command-center | 177 | — |
| base-crud-admin | 179 | transpiler-roadmap.md |
| base-doc-editor | 147 | — |
| base-feed | 217 | transpiler-readiness-audit.md |
| base-gantt | 206 | — |
| base-inbox | 150 | — |
| base-kanban | 144 | — |
| base-learning | 163 | — |
| base-ledger | 202 | — |
| base-marketplace | 144 | — |
| base-noc | 117 | — |
| base-patient-chart | 263 | — |
| base-portal | 220 | — |
| base-pos | 148 | — |
| base-scheduler | 141 | — |
| base-storefront | 225 | transpiler-readiness-audit.md |
| base-warehouse | 196 | — |
| base-wizard | 160 | — |

Only 3/20 referenced in docs. All used dynamically by `scripts/eval-local.ts` (first 5 alphabetically for smoke test).

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
| tests/stability-sweep.test.ts | — | projectflow | — | — |
| scripts/eval-local.ts | All 7 core | projectflow | — | First 5 base-* |
| scripts/demo-canonical.ts | fullstack-todo | — | — | — |
| scripts/helpdesk-golden-run.ts | — | helpdesk | — | — |
| scripts/inject-showcase.ts | todo | crm, ecommerce, clinic | blog, kanban, lms | — |
| benchmarks/complex-eval-corpus.json | — | helpdesk, projectflow, ecommerce, clinic, crm | — | — |
| gallery/catalog.json | All 7 core | All 8 showcase | All 10 gallery | — |
| src/generator.ts (replay) | todo, fullstack-todo, landing, dashboard, expense-tracker | — | — | — |
| src/mcp/server.ts | todo, expense-tracker, landing, auth, dashboard, fullstack-todo | — | — | — |
| CI (.github/workflows) | todo, fullstack-todo | projectflow | — | — |
