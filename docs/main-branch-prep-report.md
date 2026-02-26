# Main Branch Prep Report

**Date:** 2026-02-26
**Branch:** feature/stability
**Target:** main

---

## 1. Public Showcase — Final List (5 Flagship Apps)

Reduced from 8 to 5 entries in `examples/showcase-manifest.json`:

| App | File | Lines | Models | Golden | Complex Eval |
|-----|------|-------|--------|--------|-------------|
| Lumiere Studio | photography-studio-premium.air | 360 | 6 | 33 checks | Yes |
| SalesPipe CRM | crm-sales-pipeline.air | 318 | 8 | — | — |
| ProjectFlow | projectflow.air | 301 | 5 | — | Yes |
| HelpDesk | helpdesk.air | 137 | 4 | 32 checks | Yes |
| E-Commerce | ecommerce.air | 131 | 4 | — | Yes |

**Removed from showcase** (reclassified to gallery tier):
- clinic.air — still in complex-eval-corpus, gallery/catalog
- crm.air — still in complex-eval-corpus, gallery/catalog
- inventory.air — still in gallery/catalog
- monitoring.air — still in gallery/catalog

No files deleted. All paths stable.

---

## 2. Internal Fixture Classification Summary

| Tier | Count | Change |
|------|-------|--------|
| Showcase (flagship) | 5 | -4 (was 9 including monitoring which was listed in the 8-entry manifest) |
| Fixture (regression) | 7 | No change |
| Gallery (catalog + demoted) | 14 | +4 (clinic, crm, inventory, monitoring reclassified) |
| Template (base-*) | 20 | No change |
| **Total** | **46** | **No files added or removed** |

Updated manifests:
- `examples/showcase-manifest.json` — 5 entries (was 9)
- `examples/fixtures-manifest.json` — tier fields updated, summary counts updated

---

## 3. Files Changed

### Modified
| File | Change |
|------|--------|
| `README.md` | Complete rewrite: product overview, offline/key split, quickstart, flagship table, local run, validation commands, troubleshooting, docs index |
| `examples/showcase-manifest.json` | Trimmed from 9 to 5 flagship entries |
| `examples/fixtures-manifest.json` | Reclassified clinic/crm/inventory/monitoring to gallery, updated counts |
| `docs/examples-policy.md` | Updated tier counts, flagship list, policy wording |
| `docs/examples-inventory-and-usage.md` | Updated showcase/gallery counts, cross-reference matrix |
| `tests/stability-sweep.test.ts` | Updated test: `has 9 complex showcase entries` → `has 5 flagship showcase entries` |

### Created
| File | Purpose |
|------|---------|
| `examples/README.md` | Examples directory guide with tier system and run instructions |
| `docs/quickstart-local.md` | Step-by-step local setup (offline, no key) |
| `docs/run-flagship-apps-locally.md` | Copy-paste instructions for all 5 flagship apps |
| `docs/what-to-expect.md` | What AirEngine is/isn't, generated output structure, scale |
| `docs/troubleshooting-local.md` | Common issues and fixes (ports, Prisma, tsx, env) |
| `docs/main-branch-prep-report.md` | This report |

### Not Changed
- No `.air` files modified
- No `src/` source code changes
- No parser/transpiler/validator changes
- No provider integration changes

---

## 4. Verification Results

### Core Safety

| # | Command | Result | Details |
|---|---------|--------|---------|
| 1 | `npx tsc --noEmit` | PASS | Exit code 0, no errors |
| 2 | `npx vitest run` | PASS | 1131 passed, 6 skipped (1137 total), 25 test files |
| 3 | `npm run quality-gate -- --mode offline` | PASS | 3/3 stages (foundation-check, eval-local, benchmark-compare) |

### Flagship / Regression Safety

| # | Command | Result | Details |
|---|---------|--------|---------|
| 4 | `npm run helpdesk-golden` | PASS | 32/32 capability checks, 35 files, 2479 lines, 41ms |
| 5 | `npm run photography-golden` | PASS | 33/33 capability checks, 45 files, 4061 lines, 39ms |
| 6 | `npm run eval-complex` | PASS | 6/6 fixtures, 100% success rate, avg 16ms |
| 7 | `npm run stability-sweep -- --mode offline` | PASS | 10/10 cases (5 showcase + 5 replay), 128ms |
| 8 | `npm run release-rehearsal -- --mode offline` | PASS | GO verdict, doctor/gates/canonical all pass |

### Docs/Examples Sanity

| # | Check | Result | Details |
|---|-------|--------|---------|
| 9 | showcase-manifest.json flagship-only | PASS | 5 entries: photography, crm-sales-pipeline, helpdesk, projectflow, ecommerce |
| 10 | fixtures-manifest.json complete | PASS | 46 entries, tier counts: 5+7+14+20=46 |
| 11 | `npx tsx src/cli/index.ts doctor` | PASS | Node 20.17.0, npm 10.8.2, ports available |
| 11b | Transpile helpdesk (README command) | PASS | 35 files, 2479 lines, 14ms |

### Optional

| # | Check | Result | Details |
|---|-------|--------|---------|
| 12 | `npm pack --dry-run` | PASS | 339 files, 537 kB packed, 2.5 MB unpacked |

---

## 5. Intentionally Deferred

| Item | Reason |
|------|--------|
| Physical file moves (e.g., `examples/internal/`) | Risk of breaking 10+ test/script references; manifests achieve the same classification |
| gallery/catalog.json updates | No changes needed; all 14 gallery entries still valid |
| Online eval / live rehearsal | Requires `ANTHROPIC_API_KEY`; offline gates sufficient for main prep |
| `monitoring.air` removal from complex-eval-corpus | It's not in the corpus; no action needed |

---

## 6. Ready for Main Push Checklist

- [x] Public showcase is flagship-only (5 apps)
- [x] Internal examples preserved and classified (fixtures-manifest.json)
- [x] README is detailed, accurate, and newcomer-friendly
- [x] Local setup/run docs are thorough and copy-paste friendly
- [x] Users can answer: "What is AirEngine? How do I run it? What should I expect?"
- [x] TypeScript compiles (`tsc --noEmit` exit 0)
- [x] All 1131 tests pass (6 skipped = 2 RUNTIME_QA_LIVE + 4 env-gated)
- [x] Quality gate passes (offline)
- [x] Both golden runs pass (helpdesk 32/32, photography 33/33)
- [x] Complex eval passes (6/6, 100%)
- [x] Stability sweep passes (10/10)
- [x] Release rehearsal passes (GO verdict)
- [x] Doctor passes
- [x] No `.air` grammar changes
- [x] No provider integration changes
- [x] No new features added
- [x] No direction drift from AI-first compiler product
- [x] npm pack produces valid tarball (339 files, 537 kB)

**Verdict: Ready for main push.**
