# C1 — Workflow Correctness Report

## Summary

C1 delivers three capabilities that were missing from AirEngine's complex-app codegen:
status workflow mutations (G1), aggregate consumption (G2), and detail pages (G3).

**Gap tests**: 13/32 passing (G1: 4/4, G2: 2/2, G3: 5/5, G6: 2/2 bonus)
**Regressions**: 0 — all 931 core tests pass, stability sweep 12/12, quality gate PASS
**Behavior drift**: None — all 6 simple-app golden hashes unchanged

---

## G1: Status Workflow Mutations

### Problem
Apps with enum status fields (e.g., `status:enum(open,in_progress,resolved,closed)`) only generated generic edit forms. No status-specific transition UI, no server-side validation of allowed transitions, and specialized mutations like `assign` and `resolve` didn't generate correct API payloads.

### Changes

| File | Change |
|------|--------|
| `src/transpiler/react/page-gen.ts` | Detect status enum fields → generate `handleStatusChange(id, newStatus)` handler with `<select>` dropdown in CRUD pages |
| `src/transpiler/react/page-gen.ts` | Specialize `assign` mutation to send `{ agent_id }` and `resolve` to send `{ status: 'resolved' }` |
| `src/transpiler/react/mutation-gen.ts` | Add `'resolve'` to `actionVerbs` list (was missing, blocking route match) |
| `src/transpiler/express/api-router-gen.ts` | Add `allowedTransitions` validation in `generateResourceRouter` PUT routes: lookup current status, reject invalid transitions with 400 |

### Tests passing
- TicketsPage has status transition controls
- Server validates allowed status transitions
- Assign mutation sends agent_id to API
- Resolve mutation sends status:resolved to API

---

## G2: Aggregate Consumption

### Problem
Aggregate API endpoints existed but `avgResponseTime` wasn't computed, and dashboard stat values for float/numeric fields rendered raw without formatting.

### Changes

| File | Change |
|------|--------|
| `src/transpiler/express/api-router-gen.ts` | `generateAggregateHandler` computes `avgResponseTime` from resolved/closed tickets using `createdAt` timestamps |
| `src/transpiler/react/jsx-gen.ts` | Two code paths for stat rendering now apply `.toFixed(1)` when ref name contains `avg`, `time`, `rate`, or `duration` (case-insensitive). Guarded with `typeof === 'number'` check. |

### Drift prevention
The toFixed logic uses keyword matching on the ref string rather than applying to all stats. This ensures simple apps (expense-tracker `#total`, dashboard `#stats.active`) are unaffected. Verified: golden hashes for expense-tracker `App.jsx` and dashboard `OverviewPage.jsx` unchanged.

### Tests passing
- Stats endpoint computes avgResponseTime
- DashboardPage renders stat values with proper formatting

---

## G3: Detail Pages

### Problem
No `/:model/:id` page generation existed. Apps with nested child routes (e.g., `/tickets/:id/replies`) had no way to view a single resource with its related data.

### Changes

| File | Change |
|------|--------|
| `src/transpiler/react/page-gen.ts` | `detectDetailPageModels()` — scans expanded routes for `/parent/:id/child` patterns to identify models needing detail pages |
| `src/transpiler/react/page-gen.ts` | `generateDetailPage()` — generates detail page with single-resource fetch, field display, reply thread rendering, and reply form with FK auto-fill |
| `src/transpiler/api-client-gen.ts` | Auto-generate `getTicket(id)` singular fetch functions for models with nested child routes |
| `src/transpiler/express/api-router-gen.ts` | Auto-generate `GET /:id` findUnique route in resource routers when nested children exist but no explicit GET-by-id route |
| `src/transpiler/react/index.ts` | Import detail page components (lazy or direct), add `selectedTicketId` state, wire routing |
| `src/transpiler/react/jsx-gen.ts` | Detail page conditional rendering in auth-gated page switcher |

### Generated output (helpdesk)
- `client/src/pages/TicketDetailPage.jsx` — new file
- `client/src/api.js` — adds `getTicket(id)`, `getTicketReplies(id)`
- `server/routes/tickets.ts` — adds `GET /:id` route
- `client/src/App.jsx` — routes `selectedTicketId` to detail page

### Tests passing
- Generates a TicketDetailPage component
- App.jsx has a route for /tickets/:id
- Detail page fetches single ticket by ID
- Detail page displays reply thread
- Detail page has reply form

### Bonus: G6 Nested CRUD (2 tests)
The detail page implementation naturally satisfies two G6 (Nested CRUD) tests:
- UI renders ticket replies (nested data display)
- Reply creation form auto-fills ticket_id FK

---

## Golden Snapshot Updates

| App | Before | After | Change |
|-----|--------|-------|--------|
| helpdesk | 34 files | 35 files | +TicketDetailPage.jsx |
| projectflow | 44 files | 45 files | +TaskDetailPage.jsx |
| todo | 9 files | 9 files | No change |
| expense-tracker | 9 files | 9 files | No change |
| auth | 21 files | 21 files | No change |
| dashboard | 26 files | 26 files | No change |
| landing | 9 files | 9 files | No change |
| fullstack-todo | 25 files | 25 files | No change |

---

## Verification Results

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 931 passed, 4 skipped |
| `npx vitest run --config vitest.config.gaps.ts` | 13 passed (≥11 target met) |
| `npm run stability-sweep` | 12/12 — 0 failures |
| `npm run quality-gate -- --mode offline` | PASS (3/3) |
| `npx vitest run tests/complex-app-baseline.test.ts` | 3 passed |
| `npx vitest run tests/snapshots.test.ts` | 11 passed (after update) |

---

## Remaining Gaps (C2–C4 scope)

| Gap | Tests | Phase |
|-----|-------|-------|
| G4: Server-side filter/sort | 0/4 | C2 |
| G5: RBAC UI gating | 0/3 | C2 |
| G7: Form validation | 0/2 | C2 |
| G8: DataTable column config | 0/3 | C3 |
| G9: Pagination controls | 0/4 | C3 |
| G12: Email route wiring | 0/3 | C4 |
