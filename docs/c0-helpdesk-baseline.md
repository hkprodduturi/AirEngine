# C0 — Helpdesk Baseline Audit

**Date**: 2026-02-25
**Source**: `examples/helpdesk.air` (138 lines, 5 models, 4 relations, 10 routes)
**AirEngine Version**: 0.1.7

## Loop Pipeline Results

All 5 stages pass:

| Stage | Status | Duration | Details |
|-------|--------|----------|---------|
| validate | pass | 11ms | 0 errors, 2 warnings |
| repair | skip | 0ms | No errors to repair |
| transpile | pass | 12ms | 34 files, 2151 lines |
| smoke | pass | 0ms | All L0/L1 checks pass |
| determinism | pass | 3ms | All hashes stable |

**Warnings** (non-blocking):
- `AIR-W004`: State field `departments` appears unused in @ui
- `AIR-W004`: State field `priorityFilter` appears unused in @ui

## Generated Files (34 total)

### Client (15 files)
| File | Lines | Status |
|------|-------|--------|
| client/package.json | 23 | OK |
| client/vite.config.js | 8 | OK |
| client/tailwind.config.cjs | 37 | OK |
| client/postcss.config.cjs | 7 | OK |
| client/index.html | 14 | OK |
| client/src/main.jsx | 12 | OK |
| client/src/index.css | 183 | OK |
| client/src/App.jsx | 81 | OK — auth flow, page routing |
| client/src/Layout.jsx | 105 | OK — sidebar navigation |
| client/src/api.js | 139 | OK — all 10 API client functions |
| client/src/types.ts | 44 | OK — TS interfaces |
| client/src/pages/LoginPage.jsx | 31 | OK — login form |
| client/src/pages/DashboardPage.jsx | 83 | **Partial** — stats render but fragile |
| client/src/pages/TicketsPage.jsx | 179 | **Partial** — CRUD works, gaps below |
| client/src/pages/AgentsPage.jsx | 70 | **Partial** — list only, read-only |

### Server (18 files)
| File | Lines | Status |
|------|-------|--------|
| server/package.json | 29 | OK |
| server/tsconfig.json | 20 | OK |
| server/.env | 10 | OK |
| server/prisma/schema.prisma | 68 | OK — 5 models, relations, indexes |
| server/prisma.ts | 7 | OK |
| server/seed.ts | 45 | OK — FK-safe seeding |
| server/types.ts | 24 | OK — request body types |
| server/validation.ts | 53 | OK |
| server/routes/tickets.ts | 74 | OK — CRUD with pagination |
| server/routes/agents.ts | 37 | OK — read-only |
| server/routes/departments.ts | 36 | OK — read-only |
| server/api.ts | 81 | OK — auth, nested replies, stats |
| server/auth.ts | 74 | OK — JWT HMAC-SHA256 |
| server/env.ts | 18 | OK — env validation |
| server/templates.ts | 80 | **Partial** — templates exist, never called |
| server/middleware.ts | 39 | OK |
| server/server.ts | 97 | OK — helmet, CORS, rate limiting |
| README.md | 195 | OK |

### Meta (1 file)
| File | Lines | Status |
|------|-------|--------|
| _airengine_manifest.json | 174 | OK |

## Gap Analysis — What's Missing

### G1: Status Workflow Mutations — MISSING
**Expected**: Ticket status transitions (open → in_progress → waiting → resolved → closed) via dedicated UI control (dropdown/select) that calls `PUT /tickets/:id` with new status.
**Actual**: TicketsPage has generic CRUD (create form with status field, edit/delete buttons) but no dedicated status transition UI. The `.air` file has `!assign(#ticket.id)` and `!resolve(#ticket.id)` mutations in the UI spec, but these are rendered as generic ghost buttons with no wired handlers — they produce `onClick` handlers that call console.log stubs.
**Impact**: Core workflow broken. Users can't move tickets through lifecycle.

### G2: Aggregate Consumption — PARTIAL
**Expected**: Dashboard stat cards wired to `GET /stats` endpoint data.
**Actual**: DashboardPage fetches `api.getStats()` and renders `{stats.open}`, `{stats.inProgress}`, `{stats.resolved}`, `{stats.avgResponseTime}` in stat cards. Server generates correct aggregate endpoint with per-status counts. **However**: `avgResponseTime` is not computed by the server (only counts are returned). Stats are rendered as raw values with no formatting.
**Impact**: Dashboard shows ticket counts correctly but avgResponseTime is always undefined.

### G3: Detail Pages — MISSING
**Expected**: `/tickets/:id` page showing ticket details + reply thread.
**Actual**: No detail pages generated. Client has `getTicketReplies(id)` and `createTicketReplies(id, data)` API functions but no UI consumes them. Clicking a ticket in the list only shows edit/delete actions — no way to view full ticket or its replies.
**Impact**: Reply thread (nested CRUD) is completely inaccessible from the UI.

### G4: Server-side Filter/Sort — PARTIAL
**Expected**: Tickets page filter tabs (all/open/in_progress/waiting/resolved) send `?status=X` to API. Sort by column headers.
**Actual**: Server routes/tickets.ts accepts `?sort=field:dir` and `?search=text` params but NOT `?status=X` filter. The `.air` file declares `statusFilter:enum(...)` and `tabs>statusFilter.set(...)` but client doesn't pass filter state as query params to the API. Filters are local-only UI state with no server integration.
**Impact**: Filtering shows all tickets regardless of selected tab.

### G5: RBAC UI Gating — MISSING
**Expected**: Admin sees all tickets + agent management. Agent sees assigned tickets. Customer sees own tickets only. Nav items conditionally shown by role.
**Actual**: Server has `requireAuth` middleware but no per-route `requireRole`. Client stores `user` object but never reads `user.role`. All authenticated users see identical UI.
**Impact**: No role-based access control in the UI.

### G6: Nested CRUD — MISSING
**Expected**: Ticket detail page shows reply thread. Reply form creates new reply under ticket.
**Actual**: API client has `getTicketReplies(id)` and `createTicketReplies(id, data)` but no UI renders them. Server `api.ts` has the nested routes (`GET /tickets/:id/replies`, `POST /tickets/:id/replies`).
**Impact**: Reply functionality exists server-side but is invisible to users.

### G7: Form Validation — MISSING
**Expected**: Create ticket form has `required` on subject/description fields. Inline error messages for missing fields.
**Actual**: Form inputs have no `required` attribute. No inline validation. Form submits even with empty fields, relying entirely on server-side 400 errors.
**Impact**: Poor UX — users get generic console errors instead of inline validation feedback.

### G8: DataTable Column Config — MISSING
**Expected**: Tickets table with named columns (Subject, Status, Priority, Assignee, Created), sortable headers.
**Actual**: Tickets are rendered in a generic `divide-y` list with fields displayed but no table headers, no column labels, no sort controls. The DataTable component is not used (not auto-detected for this page).
**Impact**: Ticket list lacks structure and sort capability.

### G9: Pagination Controls — MISSING
**Expected**: Prev/Next buttons at bottom of ticket list. Page state tracked.
**Actual**: Server returns `meta.total` and `totalPages` in paginated responses but client discards pagination meta (loads data into flat array). No page navigation UI.
**Impact**: Only first 20 tickets visible; no way to navigate to more.

### G10: Cron Activation — N/A
helpdesk.air does not declare `@cron`. Not tested in this baseline.

### G11: Queue Activation — N/A
helpdesk.air does not declare `@queue`. Not tested in this baseline.

### G12: Email Route Wiring — MISSING
**Expected**: `sendEmail('ticketCreated', ...)` called after POST /tickets. `sendEmail('ticketResolved', ...)` called when status changes to resolved.
**Actual**: `server/templates.ts` has complete email template infrastructure with `sendEmail()` function, but it's never imported or called from any API route handler.
**Impact**: Email notifications configured but never triggered.

## Summary

| Category | Working | Partial | Missing |
|----------|---------|---------|---------|
| Infrastructure (scaffold, build, Prisma) | 18 files | — | — |
| Auth (JWT, login flow) | Yes | — | — |
| CRUD (tickets, agents) | Yes | — | — |
| Status Workflow | — | — | G1 |
| Aggregates/Stats | — | G2 (counts work, avgResponseTime missing) | — |
| Detail Pages | — | — | G3 |
| Filter/Sort | — | G4 (server accepts, client doesn't send) | — |
| RBAC UI | — | — | G5 |
| Nested CRUD | — | — | G6 |
| Form Validation | — | — | G7 |
| DataTable Config | — | — | G8 |
| Pagination UI | — | — | G9 |
| Email Wiring | — | G12 (templates exist, not called) | — |

**Bottom line**: The helpdesk app generates successfully (34 files, all loop stages pass) and the basic CRUD + auth skeleton works. But 7 of 12 applicable capabilities are missing, making the app demo-grade rather than production-grade.

## Test Organization

Tests are split into two files with separate CI paths:

| File | Tests | CI Path | Command |
|------|-------|---------|---------|
| `tests/complex-app-baseline.test.ts` | 3 passing | Default CI | `npx vitest run` or `npm run test:complex-baseline` |
| `tests/complex-app-gaps.test.ts` | 32 failing (expected) | Opt-in only | `npm run test:complex-gaps` |

**Baseline suite** (`complex-app-baseline.test.ts`):
- Included in default `npx vitest run` — must always pass
- Verifies helpdesk.air parse + transpile succeeds, file count >= 34, no broken imports

**Gap acceptance suite** (`complex-app-gaps.test.ts`):
- Excluded from default CI via `vitest.config.ts`
- Run explicitly: `npm run test:complex-gaps`
- Each test targets a specific missing capability (G1–G12)
- All 32 tests are expected to fail until the corresponding C1–C4 phase lands
- Progress tracking: count of passing tests increases with each phase

Commands:
```
npx vitest run                  # default CI — must be green
npm run test:complex-baseline   # baseline only (3 tests, all pass)
npm run test:complex-gaps       # gap suite (32 tests, all expected to fail)
```
