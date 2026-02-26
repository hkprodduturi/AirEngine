# Examples Cleanup Report

> Reclassification of `examples/` directory to complex-only public showcase.

## Changes Made

### 1. Showcase Manifest (`examples/showcase-manifest.json`)

**Before**: 7 entries mixing simple (todo, landing, expense-tracker), medium (auth, dashboard, fullstack-todo), and complex (projectflow).

**After**: 8 entries — **complex apps only** (100+ lines, 3+ models, fullstack):
- helpdesk (137 lines) — **NEW** (was missing despite golden run coverage)
- projectflow (301 lines) — retained
- ecommerce (131 lines) — **NEW**
- crm-sales-pipeline (318 lines) — **NEW**
- clinic (159 lines) — **NEW**
- crm (169 lines) — **NEW**
- inventory (146 lines) — **NEW**
- monitoring (168 lines) — **NEW**

Schema version bumped from 1.0 to 2.0 to reflect the policy change.

### 2. Fixtures Manifest (`examples/fixtures-manifest.json`)

**NEW file**. Classifies all 46 `.air` files into 4 tiers:
- **showcase** (8): complex apps for public demos
- **fixture** (7): internal regression/benchmark corpus
- **gallery** (10): catalog entries, medium complexity
- **template** (20): base-* files for AI generation guidance

Each entry includes: file path, line count, fullstack/auth flags, usedBy references, and notes.

### 3. Policy Doc (`docs/examples-policy.md`)

**NEW file**. Defines tier rules, criteria for adding showcase/fixture/template examples, and lists all 8 verification gates.

### 4. Inventory & Usage Map (`docs/examples-inventory-and-usage.md`)

**NEW file**. Complete dependency audit of all 46 files with:
- Per-tier tables with line counts and test coverage
- Cross-reference matrix (consumer x tier)
- Key dependency chains documented

### 5. README.md

Updated "Examples" section (was "Eight example apps"):
- Renamed to "Showcase Apps"
- Lists 8 complex apps with descriptions and line counts
- Mentions fixtures, gallery, and templates as secondary

### 6. Alpha Launch Checklist (`docs/alpha-launch-checklist.md`)

Updated to expect 8+ showcase entries and fixtures-manifest.json.

### 7. Test Fix (`tests/stability-sweep.test.ts`)

Updated "Showcase manifest" tests:
- Schema version: `1.0` → `2.0`
- Length: 7 → 8
- Content checks: `todo`+`projectflow` → `helpdesk`+`projectflow`+`ecommerce`+`crm-sales-pipeline`
- Added: all entries must have `complexity: 'complex'`

## Files Changed

| File | Action |
|------|--------|
| `examples/showcase-manifest.json` | Rewritten (7 mixed → 8 complex-only) |
| `examples/fixtures-manifest.json` | Created (46-file inventory) |
| `docs/examples-policy.md` | Created |
| `docs/examples-inventory-and-usage.md` | Created |
| `docs/examples-cleanup-report.md` | Created |
| `README.md` | Updated examples section |
| `docs/alpha-launch-checklist.md` | Updated manifest expectations |
| `tests/stability-sweep.test.ts` | Updated manifest test assertions |

## No Files Moved or Deleted

Per the "reclassify first, no destructive moves" constraint:
- All 46 `.air` files remain in `examples/`
- No directory restructuring
- Gallery and template files untouched
- Existing test/script references unchanged

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | Clean (exit 0) |
| `npx vitest run` | 943 passed, 4 skipped (947 total) |
| `npm run quality-gate -- --mode offline` | PASS (3/3) |
| `npm run helpdesk-golden` | 32/32 PASS |
| `npm run eval-complex` | 5/5 (100% success) |

## Inventory Summary

| Tier | Count | Lines | Policy |
|------|-------|-------|--------|
| Showcase | 8 | 1,629 | Public demos, complex-only |
| Fixture | 7 | 214 | Internal regression corpus |
| Gallery | 10 | 1,407 | Catalog entries, medium |
| Template | 20 | 3,463 | AI generation guidance |
| **Total** | **46** | **6,713** | |
