# C2 — Data & Auth Implementation Report

## Summary

C2 implements server-side filter/sort (G4), RBAC UI gating (G5), and form validation (G7) for the helpdesk flagship app. All 9 target gap tests now pass, bringing the total from 13 → 25 passing (out of 32).

## Results

| Metric | Before | After |
|--------|--------|-------|
| Default CI tests | 931 | 931 |
| Gap tests passing | 13/32 | 25/32 |
| Stability sweep | 12/12 | 12/12 |
| Quality gate (offline) | PASS | PASS |
| Release rehearsal (offline) | GO | GO |

### Gap Test Breakdown

| Group | Tests | Before | After | Status |
|-------|-------|--------|-------|--------|
| G1: Status workflow | 4 | 4/4 | 4/4 | Preserved |
| G2: Aggregate consumption | 2 | 2/2 | 2/2 | Preserved |
| G3: Detail pages | 5 | 5/5 | 5/5 | Preserved |
| G4: Server-side filter/sort | 4 | 0/4 | **4/4** | NEW |
| G5: RBAC UI gating | 3 | 0/3 | **3/3** | NEW |
| G6: Assignment workflow | 2 | 2/2 | 2/2 | Preserved |
| G7: Form validation | 2 | 0/2 | **2/2** | NEW |
| G8: DataTable config | 2 | 0/2 | 0/2 | Out of scope |
| G9: Pagination controls | 4 | 0/4 | 0/4 | Out of scope |
| G12: Email route wiring | 3 | 0/3 | 0/3 | Out of scope |

## Implementation Details

### G4: Server-Side Filter/Sort (4 tests)

**Files changed:**
- `src/transpiler/express/api-router-gen.ts` — `generateFindManyHandler()`: Added enum field detection and query param filtering. Enum fields on the model (e.g., `status`, `priority`) are read from `req.query.<field>` and merged into the Prisma `where` clause alongside existing search conditions.
- `src/transpiler/api-client-gen.ts` — Extended list function signatures with `...filters` rest param. Added `Object.entries(filters)` loop to forward non-empty, non-'all' filter values as URL search params.
- `src/transpiler/react/page-gen.ts` — `generateCrudPage()`: Detects filter state variables (e.g., `statusFilter` → `status` field, `priorityFilter` → `priority` field) from `@state` enum declarations that match model field names. Adds `sortField`/`sortOrder` state. Passes filter/sort params to API calls and adds `useEffect` dependencies for automatic re-fetch.

### G5: RBAC UI Gating (3 tests)

**Files changed:**
- `src/transpiler/express/api-router-gen.ts` — `generateResourceRouter()`: When `ctx.auth.role` exists, imports `requireRole` from auth module. Non-primary resources (< 3 CRUD routes) get admin-only middleware wrapping POST/PUT/DELETE operations.
- `src/transpiler/react/page-gen.ts` — `generateCrudPage()`: When auth has role field, derives `const isAdmin = user?.role === 'admin'` for role-based conditional rendering. Admin resources get create/delete buttons wrapped in `{user?.role === 'admin' && (...)}` guards.

### G7: Form Validation (2 tests)

**Files changed:**
- `src/transpiler/react/page-gen.ts`:
  - Added `fieldErrors` state (`useState({})`) to CRUD pages with create forms
  - `handleCreate`: Validates required fields before API call, sets `fieldErrors` on failure with `"<Field> is required"` messages
  - `renderFormField`: Appends inline `{fieldErrors.<field> && <p>...</p>}` error display for required fields
  - Fixed textarea attribute order: `name` then `required` then `rows` (previously `rows` was between `name` and `required`, breaking substring match expectation)

### Snapshot Updates

Golden snapshot hashes updated for `helpdesk.air` and `projectflow.air` to reflect new generated output.

## Drift Assessment

- **Stability sweep**: 12/12 — no drift in existing examples
- **Conformance suite**: 42/42 — no cross-target regressions
- **Backend tests**: 234/234 — no server generation regressions
- **Transpiler tests**: 167/167 — no client generation regressions

## Remaining Gaps (Out of Scope for C2)

- **G8** (DataTable config): Requires column header generation from model fields
- **G9** (Pagination controls): Requires client-side pagination state and prev/next buttons
- **G12** (Email route wiring): Requires sendEmail integration in route handlers
