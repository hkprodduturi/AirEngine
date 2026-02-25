# Complex App Readiness — Capability Audit + Phased Roadmap

**Date**: 2026-02-25
**Status**: Active
**Flagship App**: Help Desk (`examples/helpdesk.air`)

## 1. Flagship App: Help Desk

Help Desk exercises the most complex-app gaps simultaneously:
- 3-role RBAC (customer, agent, admin) with UI gating
- Status workflow mutations (open → in_progress → waiting → resolved → closed)
- Nested CRUD (ticket → replies)
- Aggregate dashboard (open count, in-progress count, resolved count, avg response time)
- Server-side filtering/sorting (by status, priority, assignee)
- Detail page with related data (ticket detail + reply thread)
- Email templates (ticket created, ticket resolved)
- 5 models, 10 API routes, 4 pages

## 2. Complex Capability Matrix

| # | Capability | Current Status | Blocking? |
|---|-----------|---------------|-----------|
| 1 | Multi-model CRUD (5+ models) | Working (projectflow) | No |
| 2 | Relations (1:N, M:N) | Working (Prisma gen) | No |
| 3 | JWT auth (login/register/me) | Working | No |
| 4 | Role-based API guards | Working (requireRole middleware) | No |
| 5 | Status workflow mutations | **Missing** — only toggle/archive | **Yes** |
| 6 | Aggregate/computed fields | **Partial** — server generates counts but client doesn't wire to StatCard | **Yes** |
| 7 | Detail pages (/:id routes) | **Missing** — only list views generated | **Yes** |
| 8 | Server-side filter/sort/paginate | **Partial** — sort/search in server, not wired to client UI | **Yes** |
| 9 | RBAC UI gating (show/hide by role) | **Missing** — auth exists but no conditional rendering | **Yes** |
| 10 | Nested CRUD (parent → children) | **Missing** — flat resource hooks only | **Yes** |
| 11 | DataTable with sort/filter columns | **Partial** — DataTable component exists, no column config | Medium |
| 12 | Form validation (client-side) | **Missing** — no validation in generated forms | High |
| 13 | Cron job activation | **Parsed** — @cron block parsed, not wired to codegen | Low |
| 14 | Queue job activation | **Parsed** — @queue block parsed, not wired to codegen | Low |
| 15 | Email template activation | **Partial** — templates.ts generated with sendEmail(), not called from routes | Low |
| 16 | Deploy config activation | **Parsed** — @deploy parsed but no Dockerfile generation | Low |

## 3. Gap List (ranked by impact)

### Tier 1 — Workflow Correctness

| ID | Gap | Layer | Description |
|----|-----|-------|-------------|
| G1 | Status workflow mutations | Transpiler | Enum-typed status fields only get generic CRUD. Need: transition mutations with allowed-transition validation, timestamp update, UI status selector. |
| G2 | Aggregate consumption | Transpiler | Server generates `GET /stats` with counts, but client doesn't wire stats object to StatCard components properly (stats rendered but data flow is fragile). |
| G3 | Detail pages | Transpiler | No `/:id` page generation. Need: route param extraction, single-resource fetch hook, detail layout with related data sections. |

### Tier 2 — Data & Auth

| ID | Gap | Layer | Description |
|----|-----|-------|-------------|
| G4 | Server-side filter/sort | Transpiler | Server routes accept `?status=open&sort=createdAt` but client pages don't pass filter/sort params from UI controls to API calls. |
| G5 | RBAC UI gating | Transpiler | `requireRole('admin')` exists server-side but React has no role-aware conditional rendering. No `useAuth()` hook exposing role. |
| G6 | Nested CRUD | Transpiler | `getTicketReplies(id)` API client exists but no UI renders it. No detail page to display replies under a ticket. |
| G7 | Form validation | Transpiler | Generated forms have no `required` attributes or inline error messages despite `@db` field constraints being available. |

### Tier 3 — Table & Query UX

| ID | Gap | Layer | Description |
|----|-----|-------|-------------|
| G8 | DataTable column config | Transpiler | DataTable component exists but is generic. Need: auto-generated column definitions from model fields, sortable headers. |
| G9 | Pagination controls | Transpiler | API returns `meta.total` and `totalPages` but no page navigation UI in generated pages. |

### Tier 4 — Async Wiring

| ID | Gap | Layer | Description |
|----|-----|-------|-------------|
| G10 | Cron activation | Transpiler+Runtime | @cron parsed → need: node-cron setup in server entry. Dev-mode: console.log on tick. |
| G11 | Queue activation | Transpiler+Runtime | @queue parsed → need: in-memory queue setup, worker scaffold. Dev-mode: console.log on dispatch. |
| G12 | Email route wiring | Transpiler | templates.ts with sendEmail() is generated but never called from API routes (e.g., after ticket create or status change to resolved). |

## 4. Phased Roadmap (C0–C5)

### C0 — Helpdesk Baseline Audit
Create baseline docs, gap acceptance tests, golden snapshot. No transpiler changes.

**Test split**:
- `tests/complex-app-baseline.test.ts` — 3 baseline sanity tests, included in default CI (`npx vitest run`)
- `tests/complex-app-gaps.test.ts` — 32 gap acceptance tests, excluded from default CI
  - Run explicitly: `npm run test:complex-gaps`
  - All 32 expected to fail until corresponding phase lands
  - Progress tracking: passing count increases as C1–C4 phases land

### C1 — Workflow Correctness (G1, G2, G3)
Status workflow mutations, aggregate wiring, detail pages.

### C2 — Data & Auth (G4, G5, G6, G7)
Server-side filter/sort wiring, RBAC UI gating, nested CRUD, form validation.

### C3 — Table & Query UX (G8, G9)
DataTable column config, pagination controls.

### C4 — Async Wiring (G10, G11, G12)
Cron/queue/email dev-mode activation.

### C5 — Flagship Demo + Eval
Help Desk golden run, complex eval corpus, regression guard.

## 5. Complex-App Eval Plan

### Prompts (5)
1. Help desk with customers, agents, admins, ticket lifecycle
2. Project management with teams, projects, tasks, notifications
3. E-commerce with products, cart, orders, inventory
4. HR portal with employees, departments, leave requests, approvals
5. Multi-tenant SaaS with orgs, users, billing, audit log

### Metrics
| Metric | Target |
|--------|--------|
| complex_prompt_to_running_app | ≥60% by C3, ≥80% by C5 |
| capability_coverage | ≥12/16 by C3, 16/16 by C5 |
| helpdesk_full_pass | true by C5 |
| no_runtime_crashes | 0 crashes |
