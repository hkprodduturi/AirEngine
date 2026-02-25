# A1 + A2 Validation Report

## Summary

All A1 (Diagnostics) and A2 (Transpiler T1 Completion) milestones are complete.

| Milestone | Status | Tests Added |
|-----------|--------|-------------|
| A2: T1 Transpiler Completion (6 GAPs) | PASS | 0 new (12 existing T1 tests now pass) |
| A1-MVP: Diagnostics JSON + Format | PASS | 31 new tests |
| A1-Rules: Expanded Validator Rules | PASS | 13 new tests |

## Commands + Exit Codes

### A2e: Snapshot Update
```
SNAPSHOT_UPDATE=1 npx vitest run tests/snapshots.test.ts
Exit code: 0
Tests: 11 passed (11)
Suites: 1 passed (1)
```

### A2e: Full Suite (Post-A2)
```
npx vitest run
Exit code: 0
Tests: 590 passed (590)
Suites: 8 passed (8)
```

### A1-MVP Checkpoint
```
npx vitest run
Exit code: 0
Tests: 621 passed (621)
Suites: 9 passed (9)
```

### A1-Rules Checkpoint (Final)
```
npx vitest run
Exit code: 0
Tests: 634 passed (634)
Suites: 9 passed (9)
Duration: 974ms
```

## A2: GAP Fix Verification

| GAP | Outcome | Verification |
|-----|---------|-------------|
| GAP-04 | CRUD pages render `.air` UI content | T1.1: tasks page has statusFilter, search, load(), useEffect |
| GAP-03 | Server errors surfaced to UI | T1.2: CRUD page has error/successMsg state, error alert, success alert, setError in load |
| GAP-01 | HTML5 validation attributes | T1.3: `required` attribute for required fields, `type="email"`, `type="number"` |
| GAP-02 | Forgot password flow | T1.4: "Forgot Password?" link, `const forgotPassword`, server endpoint, goBack with navigation |
| GAP-06 | Cancel button recognition | T1.6: `const cancel` with `.reset`, `const cancelLogin` with `setCurrentPage('login')` |
| GAP-08 | Mutation wiring verb+model | T1.5: `resolveTicket`/`closeTicket` match `PUT:/tickets/:id` as async functions |

### Root Cause Analysis

**A2a: CRUD Expansion Bug** (root cause of T1.1, T1.2, T1.3 failures)
- `route-utils.ts:15`: `route.handler.replace(/\.\w+$/, '')` stripped model name from handler
- Input `~db.Task` → `~db.findMany` instead of `~db.Task.findMany`
- `detectPageResource` in page-gen.ts expected `~db.Task.findMany` — always failed
- Fix: `const handlerBase = route.handler;` (use full handler, don't strip)

**A2b: Auth Page/Mutation Sets** (root cause of T1.4, T1.6 failures)
- `AUTH_MUTATION_NAMES` excluded `forgotPassword`, `cancel`, `cancelLogin`, `goBack`
- Auth-gated App.jsx filtered mutations → these were silently dropped
- Fix: Extended both `AUTH_PAGE_NAMES` and `AUTH_MUTATION_NAMES` sets

**A2c: Custom Mutations in CRUD Pages** (root cause of T1.5 failures)
- CRUD pages only generated handleCreate/Update/Delete — no custom mutations
- `resolveTicket`/`closeTicket` were page-local mutations with no generation path
- Fix: After standard CRUD handlers, extract page mutations via `extractMutations`, wire to API via `findGenericRouteMatch`

**Heading-Only Content Fix** (additional fix for T1.3)
- Pages with only `h1>"Title"` were treated as "substantive content", bypassing CRUD form generation
- Fix: Added `isHeadingOnly()` check to exclude heading-only nodes from substantive content detection

## A1: Diagnostics Before/After

### Before (v1 format)
```json
{
  "valid": false,
  "error": "[AIR Parse Error] Line 4:4: Expected open_brace...",
  "location": { "line": 4, "col": 4 }
}
```

### After (v2 DiagnosticResult format)
```json
{
  "valid": false,
  "diagnostics": [
    {
      "code": "AIR-P003",
      "severity": "error",
      "message": "Expected open_brace '{', got open_paren '('",
      "location": { "line": 4, "col": 4 },
      "category": "syntax",
      "fix": {
        "description": "Fix the syntax: Expected open_brace '{', got open_paren '('"
      }
    }
  ],
  "summary": { "errors": 1, "warnings": 0, "info": 0 },
  "source_hash": "abc123...",
  "airengine_version": "0.2.0",
  "schema_version": "1.0"
}
```

### Validation Example
```json
{
  "valid": false,
  "diagnostics": [
    {
      "code": "AIR-E002",
      "severity": "error",
      "message": "No @ui block found — app has no interface",
      "category": "structural",
      "fix": { "description": "Add @ui{...} to define your app interface" }
    },
    {
      "code": "AIR-W001",
      "severity": "warning",
      "message": "No @state block found — app has no reactive state",
      "category": "structural",
      "fix": { "description": "Add @state{...} to define your app state" }
    },
    {
      "code": "AIR-L002",
      "severity": "info",
      "message": "@style not specified — default theme will be applied",
      "category": "style",
      "fix": { "description": "Add @style(...) to customize colors, fonts, and layout" }
    }
  ],
  "summary": { "errors": 1, "warnings": 1, "info": 1 }
}
```

## Diagnostic Rules Implemented

### Migrated from existing code
| Code | Severity | Rule | Source |
|------|----------|------|--------|
| AIR-E001 | error | Missing @app:name | validator E001 |
| AIR-E002 | error | No @ui block | validator E002 |
| AIR-E003 | error | Unknown model ref in @api | MCP lint |
| AIR-W001 | warning | No @state block | validator W001 |
| AIR-W002 | warning | @db without @api | MCP lint |
| AIR-W004 | warning | Unused state field | MCP lint |
| AIR-L001 | info | Missing @persist | MCP lint |

### New A1-Rules
| Code | Severity | Rule |
|------|----------|------|
| AIR-E004 | error | Duplicate @page name |
| AIR-E005 | error | @nav refs undefined page |
| AIR-E007 | error | CRUD handler refs missing model |
| AIR-E008 | error | @auth(required) without login route |
| AIR-W003 | warning | Ambiguous relation |
| AIR-W005 | warning | Auth routes without @auth block |
| AIR-W007 | warning | @db model no PK |
| AIR-L002 | info | @style not specified |

## Performance Timing

All 7 examples parse+transpile under 200ms ceiling. Cumulative under 500ms.

```
todo.air:             < 200ms PASS
expense-tracker.air:  < 200ms PASS
auth.air:             < 200ms PASS
dashboard.air:        < 200ms PASS
landing.air:          < 200ms PASS
fullstack-todo.air:   < 200ms PASS
projectflow.air:      < 200ms PASS
Cumulative:           ~53ms (well under 500ms ceiling)
```

## OV-1: Diagnostics Hardening

### OV-1 Checkpoint
```
npx vitest run
Exit code: 0
Tests: 653 passed (653)
Suites: 9 passed (9)
Duration: 982ms
```

### OV-1.1: JSON Schema
- Created `docs/diagnostics.schema.json` — JSON Schema (draft 2020-12) for DiagnosticResult v1.0
- Defines `Diagnostic`, `DiagnosticLocation`, `DiagnosticFix` in `$defs`
- Validates code pattern `^AIR-[PEWL]\d{3}$`, severity enum, category enum
- `schema_version` constrained to `"1.0"`

### OV-1.2: Deterministic Serialization (4 tests)
- `JSON.stringify` of same DiagnosticResult is byte-for-byte identical
- Serialization stable across 10 runs (Set size === 1)
- `hashSource` deterministic for same input, different for different input
- Tests added to `tests/diagnostics.test.ts`

### OV-1.3: Invalid `.air` Fixture Corpus (11 tests)
Created 9 targeted fixtures in `tests/fixtures/`:

| Fixture | Category | Expected Code |
|---------|----------|---------------|
| `parse-error-missing-brace.air` | Parse error | AIR-P* |
| `parse-error-unknown-block.air` | Parse error | AIR-P004 |
| `parse-error-unterminated-string.air` | Lex error | AIR-P002 |
| `validation-error-no-ui.air` | Validation error | AIR-E002 |
| `validation-error-unknown-model.air` | Validation error | AIR-E003 |
| `lint-warning-no-persist.air` | Lint info | AIR-L001 |
| `lint-warning-db-no-api.air` | Lint warning | AIR-W002 |
| `lint-warning-no-pk.air` | Lint warning | AIR-W007 |
| `valid-minimal.air` | Clean | No errors |

Plus 1 meta-test: all fixtures produce valid DiagnosticResult shape.

### OV-1.4: MCP Parity (5 tests)
- `air_validate` v2: valid source returns full DiagnosticResult shape
- `air_validate` v2: parse error returns DiagnosticResult with AIR-P code
- `air_lint` v2: returns same DiagnosticResult shape as `air_validate` v2
- v2 diagnostic items all have required fields (code pattern, severity enum, category enum)
- v2 summary counts match actual diagnostic array

Tests added to `tests/mcp.test.ts`.

### OV-1 New Test Count
| File | New Tests |
|------|-----------|
| `tests/diagnostics.test.ts` | +15 (deterministic serialization + fixture corpus) |
| `tests/mcp.test.ts` | +5 (MCP v2 parity) |
| **Total** | **+20 tests** |

---

## Diff Summary

### Files Created
| File | Purpose |
|------|---------|
| `src/diagnostics.ts` | Diagnostic types, factory, sorter, builder, CLI formatter |
| `tests/diagnostics.test.ts` | 58 tests for diagnostics + rules + serialization + fixtures |
| `docs/diagnostics.schema.json` | JSON Schema for DiagnosticResult v1.0 |
| `tests/fixtures/*.air` (9 files) | Invalid/valid .air fixture corpus |

### Files Modified
| File | Change |
|------|--------|
| `src/transpiler/route-utils.ts` | A2a: Fix CRUD expansion (1 line) |
| `src/transpiler/react/helpers.ts` | A2b: Expand AUTH_PAGE_NAMES + AUTH_MUTATION_NAMES |
| `src/transpiler/react/mutation-gen.ts` | A2c: Export `findGenericRouteMatch` |
| `src/transpiler/react/page-gen.ts` | A2c: Custom mutation gen + heading detection |
| `src/validator/index.ts` | A1: diagnose() with 15 rules, backward-compat validate() |
| `src/mcp/server.ts` | A1: v2 format for air_validate + air_lint |
| `src/index.ts` | A1: Export diagnostics types + functions |
| `tests/__snapshots__/golden.json` | Updated hashes after A2 fixes |
| `tests/mcp.test.ts` | OV-1.4: MCP v2 parity tests (+5 tests) |
| `docs/ai-first-product-direction.md` | F1+F3: AI-first principles, determinism scope |
| `docs/validation-diagnostics-spec.md` | F2: schema_version field |
| `docs/ai-benchmark-plan.md` | F4: Hypothesis labels on all targets |

---

## Appendix: Exact Verification Commands

All commands run from the project root (`AirEngine/`).

### Full Test Suite
```bash
npx vitest run
# Exit code: 0
# Tests: 653 passed (653)
# Suites: 9 passed (9)
```

### Loop CLI — Pass Case
```bash
npx tsx src/cli/index.ts loop examples/todo.air -o /tmp/air-loop-test
# Exit code: 0
# Stages: validate PASS, repair SKIP, transpile PASS, smoke PASS, determinism PASS
# Output: 9 files
# Artifacts: .air-artifacts/<timestamp>/
```

### Loop CLI — Fail Case
```bash
npx tsx src/cli/index.ts loop tests/fixtures/validation-error-no-ui.air -o /tmp/air-loop-fail
# Exit code: 1
# Stages: validate FAIL, repair SKIP
# Diagnostics: 1 error (AIR-E002)
```

### Benchmark Run
```bash
npx tsx scripts/benchmark-baseline.ts
# Exit code: 0
# All 7 examples under 200ms: YES
# Cumulative under 500ms: YES
# Hash stability: ALL STABLE
# Output: artifacts/benchmarks/offline-baseline.json
```

### Type Check
```bash
npx tsc --noEmit
# Exit code: 0
```

**Note**: `npx tsx` is used to run TypeScript files directly. Equivalent: `node --import tsx src/cli/index.ts`.
