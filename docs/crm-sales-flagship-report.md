# CRM Sales Pipeline — Flagship Quality Report

## Scope

SalesPipe CRM is the most complex AirEngine showcase app, designed to demonstrate enterprise-grade CRM functionality with 8 data models, 28+ API endpoints, 8 pages, role-based auth, cron jobs, queues, and email templates.

---

## Data Model

| Model | Fields | Relations | Notes |
|-------|--------|-----------|-------|
| User | 8 | owns: accounts, contacts, leads, opportunities, tasks, activities | Roles: admin, sales_manager, sales_rep |
| Account | 13 | owner→User, has: contacts, opportunities | Status: active, inactive, prospect |
| Contact | 11 | account→Account, owner→User, has: opportunities, activities | Status: active, inactive |
| Lead | 12 | owner→User | Source: web, referral, cold_call, trade_show, partner, other |
| Opportunity | 11 | account→Account, contact→Contact, owner→User, has: activities | Stage: 6-step pipeline |
| Task | 10 | owner→User | Priority: low, medium, high, urgent |
| Activity | 9 | contact→Contact, opportunity→Opportunity, user→User | Type: call, email, meeting, note |
| Tag | 4 | polymorphic (entity_type + entity_id) | Flexible entity tagging |

**Relations**: 11 defined, including cascading deletes (User→Activity) and SetNull on optional FKs.
**Indexes**: 5 (User.email unique, Lead.status, Opportunity.stage, Task.status+due_date, Activity.user_id+created_at, Tag.entity_type+entity_id).

---

## Seed Data Metrics

| Entity | Count | Messy Features |
|--------|-------|----------------|
| Users | 6 | Whitespace in names |
| Accounts | 25 | Mixed industries, revenue ranges $2M-$120M |
| Contacts | 60 | ALL-CAPS names, mixed phone formats |
| Leads | 40 | Missing emails (~20%), varied sources |
| Opportunities | 35 | Pipeline value $13.6M, 62.5% win rate |
| Tasks | 50 | Overdue tasks, mixed priorities |
| Activities | 80 | All 4 types, varied durations |
| Tags | 128 | Duplicate/inconsistent capitalization |
| **Total** | **424** | |

---

## Demo Output

- **Files generated**: 42
- **Lines of code**: ~4,450
- **Client**: 12 files (App, Layout, 8 pages, api.js, types)
- **Server**: 13 files (server.ts, api.ts, auth.ts, prisma.ts, 5 route files, types, validation, 2 block files)
- **Config**: 7 files (package.json x2, vite.config, tailwind, postcss, index.html, index.css)
- **Prisma**: schema.prisma + seed file

---

## Quality Issues Found and Fixed

### P0 — Runtime Bugs (6 fixed)

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| ActivitiesPage calls wrong API | Page gen picks `getOpportunityActivities` for standalone activities page | Changed to `getActivities()` |
| Deals/Dashboard filter never matches | Filter uses `_item.dealStage` but data has `stage` | Changed filter field to `_item.stage` |
| "New Deal" button doesn't open form | Missing `onClick` handler on generated button | Added `onClick={() => setShowForm(!showForm)}` |
| Assign calls `updateUser` instead of entity | Mutation gen maps `assign` to User model | Fixed to call `updateLead` / `updateTask` |
| Stats endpoint returns only count | Generated `~db.Opportunity.aggregate` maps to basic count | Replaced with computed dashboard metrics |
| API returns raw IDs, UI expects names | No Prisma include/join in generated routes | Added `include` with `select` for owner, account, contact |

### P1 — Visual Quality (5 fixed)

| Issue | Fix |
|-------|-----|
| App name "Crm Sales Pipeline" | Changed to "SalesPipe CRM" in Layout, mobile header, and HTML title |
| Name rendering fragmented (first + last) | Merged into single `<span>` with proper spacing |
| Related type + name as siblings | Combined into single `<span>` with conditional separator |
| Activity contact + date fragmented | Combined into single muted `<span>` |
| Deal probability missing % suffix | Changed from separate `{"%"}` to inline `{deal.probability}%` |

### P1 — Functional Stubs (3 fixed)

| Action | Was | Now |
|--------|-----|-----|
| Qualify lead | `console.log` stub | `updateLead(id, { status: 'qualified' })` |
| Convert lead | `console.log` stub | `updateLead(id, { status: 'converted' })` |
| Advance deal | `console.log` stub | Stage progression through pipeline order |

---

## Verification Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` | Clean (0 errors) |
| `vitest run` | 943 passed, 4 skipped (947 total) |
| `quality-gate --mode offline` | PASS (3/3: foundation, eval-local, benchmark) |
| `helpdesk-golden` | 32/32 PASS |
| `eval-complex` | 5/5, 100% prompt→running-app rate |
| Client Vite compile | 8/8 pages 200 OK |
| Server API health | All 28+ endpoints responding |
| Auth flow | Login/logout with JWT, session persistence |
| CRUD operations | Create/update/delete verified on leads, opportunities |
| Pagination | Page navigation working on all list views |
| Status filters | Tabs correctly filter by stage/status |
| Search | Full-text search across entity fields |

---

## Dashboard Stats (Live)

| Metric | Value |
|--------|-------|
| Pipeline Value | $13.6M |
| Active Deals | 27 |
| Win Rate | 62.5% |
| New Leads | 10 |
| Avg Deal Size | $464,453 |
| Tasks Due Today | 1 |

---

## Architecture Notes

- **Auth**: JWT HMAC-SHA256, role-based (admin/sales_manager/sales_rep), session via localStorage
- **Layout**: Sidebar navigation with mobile hamburger, user section with avatar + role display
- **Theme**: Enterprise-clean dark variant (`--bg:#0f172a`, accent `#6366f1` indigo)
- **Data enrichment**: API routes use Prisma `include` to join owner/account/contact names
- **Status transitions**: Server-side validation prevents invalid status changes
- **Lazy loading**: React.lazy for all 8 pages with Suspense spinner
