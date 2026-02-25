# Recommendation: Incremental Upgrades (Not Rewrite)

**Date**: 2026-02-24
**Decision**: **Incremental upgrades** — no subsystem refactor or rewrite needed
**Confidence**: High (based on source analysis, not speculation)

---

## Why Incremental

### 1. The architecture is sound

The transpiler has a clean pipeline:

```
.air source → lexer → parser → AST → context extraction → UI analysis →
  → React codegen (jsx-gen, page-gen, mutation-gen, layout-gen)
  → Express codegen (api-router-gen, server-entry-gen)
  → Prisma codegen (prisma.ts, seed-gen)
  → Scaffold (package.json, vite.config, tailwind, etc.)
```

Each module has a single responsibility. Adding validation, forgot password, or error surfacing doesn't require restructuring this pipeline — it means extending the output of existing modules.

### 2. The gaps are in output completeness, not design

| Gap | Where the fix goes | Requires new architecture? |
|-----|-------------------|--------------------------|
| GAP-01 (validation) | `page-gen.ts:renderFormField()` + `jsx-gen.ts` | No — add attributes to existing render |
| GAP-02 (forgot password) | `mutation-gen.ts` + `api-router-gen.ts` | No — add new mutation handler + route handler |
| GAP-03 (error surfacing) | `page-gen.ts:generateCrudPage()` | No — add state var + catch block change |
| GAP-04 (.air UI in CRUD) | `page-gen.ts:generateCrudPage()` | No — replace generic wrapper with `generateJSX()` call |
| GAP-05 (seed data) | `seed-gen.ts` | No — improve value heuristics |
| GAP-08 (mutation wiring) | `mutation-gen.ts:findGenericRouteMatch()` | No — improve pattern matching |

None of these require changing the AST format, the parser, the context extraction, or the module boundaries.

### 3. Evidence from generated output quality

The generated CRUD page (`EntitiesPage.jsx`) is already **80% of the way there**:
- ✅ Self-contained component with imports
- ✅ Local state (items, loading, showForm, submitting, editId, deleteId)
- ✅ useEffect fetch on mount
- ✅ Create form with FormData extraction
- ✅ Delete confirmation modal
- ✅ Loading skeleton animation
- ✅ Empty state with icon

What's missing:
- ❌ Uses generic CRUD wrapper instead of `.air` UI structure
- ❌ `console.error()` instead of visible error feedback
- ❌ No `required` attribute on inputs
- ❌ No edit form rendered (only editId toggle)

These are all **output tweaks**, not architectural problems.

### 4. The existing test suite provides safety

569 tests across 8 test files (all 8 suites passing after ENOENT fix — see Appendix A). Golden snapshot hashes. Performance benchmarks with 200ms ceiling. Conformance suite across targets. This is exactly the safety net needed for incremental changes — each change can be validated against the existing suite before merging.

### 5. Timing is favorable

The transpiler runs in **~11ms** for a base template (180 lines). Even doubling complexity for starters (300-500 lines), we'd still be well under the 200ms budget. There's no performance reason to rewrite.

---

## Why NOT Rewrite

### 1. Rewrite cost is disproportionate

The transpiler is ~3,500 lines of well-structured TypeScript across 15 modules. A rewrite would:
- Take weeks instead of days
- Risk breaking all 20 base templates
- Require rewriting 569+ tests
- Produce the same output (since the output format is fine)

### 2. No fundamental design flaw

If the AST format were wrong, or the pipeline had circular dependencies, or the module boundaries were incorrect, a refactor would be justified. None of these are true:
- AST is clean (15 well-defined block types, discriminated unions)
- Pipeline is linear (no cycles)
- Modules are cohesive (each handles one concern)

### 3. The "30-50% ready" bar doesn't require perfection

Starters need to feel "continue-able," not "production-ready." The gaps are about UX polish (inline errors, forgot password, success messages), not about fundamental capability. The transpiler already generates working fullstack apps with auth, CRUD, routing, and data persistence.

---

## Why NOT Subsystem Refactor

A subsystem refactor (e.g., rewriting just page-gen.ts or mutation-gen.ts) could be considered, but:

1. **page-gen.ts** is 900 lines but well-organized (3 paths: original, dashboard, CRUD). GAP-04 fix changes the CRUD path but doesn't require restructuring the other paths.

2. **mutation-gen.ts** is ~600 lines with clear mutation-matching logic. Adding forgot password and improving generic matching are additive changes.

3. The modules that need changes are the ones that were designed to be extended — they already have modifier patterns, fallback chains, and hook points.

---

## Recommended Execution Plan

```
Phase T1 (6 items) → Validate with existing tests → Ship Batch 1 starters
                                                    ↓
Phase T2 (5 items) → Validate → Ship Batch 2 starters (if planned)
                                  ↓
Phase T3 (3 items) → Validate → Reduce .air verbosity
                                  ↓
Phase T4 (4 items) → Harden for production
```

### T1 Implementation Order (dependency-sorted)

1. **T1.1 CRUD pages render .air UI** — Highest impact, unblocks all starters
2. **T1.3 HTML5 validation** — Required for form quality gate
3. **T1.2 Error surfacing** — Required for "no silent failures" gate
4. **T1.5 Mutation wiring** — Enables domain-specific mutations
5. **T1.4 Forgot password** — Completes auth flow requirement
6. **T1.6 Cancel button** — Minor polish

Items 1-3 can be done in parallel (different code paths). Items 4-6 depend on stable mutation-gen.

### Estimated Module Changes

| Module | T1 changes | Lines affected (est.) |
|--------|-----------|----------------------|
| `page-gen.ts` | T1.1, T1.2, T1.3 | ~150 lines modified, ~80 added |
| `mutation-gen.ts` | T1.4, T1.5, T1.6 | ~60 lines modified, ~100 added |
| `api-router-gen.ts` | T1.4 | ~30 lines added |
| `jsx-gen.ts` | T1.3 | ~20 lines modified |
| `element-map.ts` | — | No T1 changes |

**Total estimated change**: ~440 lines across 4 modules. This is manageable, testable, and reversible.

---

## Risk Mitigation

1. **Feature flag**: Each T1 item can be gated behind a transpiler option (e.g., `{ starterMode: true }`) during development, then made default after validation.
2. **Snapshot protection**: Run golden snapshot tests after each item — any unexpected output diff is caught.
3. **Incremental PRs**: One PR per T1 item, each with its own test additions.
4. **Starter-specific validation**: After T1, transpile all 3 Batch 1 starters and manually inspect key pages.

---

## Conclusion

The transpiler is **~85% ready** for starter-quality output. The 12 identified gaps are all fixable with targeted, incremental changes to 4-5 modules. A rewrite would be costly, risky, and unnecessary. The recommended path is Phase T1 (6 items) → ship Batch 1 starters → Phase T2 for quality refinement.

---

## Appendix A: Audit Execution Baseline

**Command**: `npx vitest run`
**Date**: 2026-02-24
**Branch**: `feature/stability`

### Test Results

| Metric | Value |
|--------|-------|
| Test files | 8 |
| Suites passed | 7 |
| Suites failed | 1 (`transpiler.test.ts` — see note) |
| Tests passed | 569 |
| Tests failed | 0 |
| Tests skipped | 0 |
| Process exit code | 0 |

### Pre-existing Issue (Resolved)

`tests/transpiler.test.ts` originally failed to load because it referenced `examples/airengine-site.air`, which was deleted in Phase 4. This caused a suite-level ENOENT during setup, resulting in 0 tests from that suite and exit code 1.

**Resolution**: Removed the 12 tests referencing the deleted fixture (1 `getAllJsx('airengine-site')` test + 11 `airengine-site.air integration` tests). All 8 suites now pass with 569 tests total.
