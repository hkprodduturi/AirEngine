# Starter Template Readiness Rubric (0–100)

## Purpose

Defines a measurable scoring system so "30–50% app-ready" is objective, not subjective. Each criterion is scored against what a **production-quality app of the same type** would require. A score of 40 means the starter provides 40% of the total effort to reach production.

---

## Scoring Criteria

### 1. Domain Model Completeness (15 points)

How complete is the data model vs. what a production app needs?

| Score | Description |
|:-----:|-------------|
| 0–3 | Generic entities (`Entity`, `Item`) with placeholder fields |
| 4–6 | Some real domain entities but missing important fields/relationships (e.g., no timestamps, no soft-delete, incomplete enums) |
| 7–9 | Core entities with realistic fields and relations; missing 2+ secondary entity groups (e.g., has Users+Products but no Reviews, Notifications, or Settings entities) |
| 10–12 | Core + some secondary entities; minor gaps (e.g., has Reviews but no Favorites) |
| 13–15 | Complete model covering all entity groups a production app would need |

**Starter target: 7–10.** Real core entities with proper fields, typed enums, and relations. Missing secondary/tertiary entity groups that a production app would eventually add.

**How to verify:** Count entity groups present vs. what a production app of this type typically has. A restaurant POS production app needs: menu items, categories, orders, order items, tables, reservations, staff, shifts, tips, payments, inventory, suppliers — starter covers menu, categories, orders, order items, tables, staff (6/12 = 50% of entity groups ≈ 8/15 on rubric).

---

### 2. Core Workflow Coverage (25 points)

How many end-to-end user journeys work vs. what a production app offers?

| Score | Description |
|:-----:|-------------|
| 0–5 | No complete end-to-end workflow; CRUD screens exist but don't connect |
| 6–10 | 1–2 basic happy-path workflows (e.g., create order → checkout, but no error recovery or edge cases) |
| 11–15 | 2–4 core workflows work end-to-end; basic error handling; no complex business logic |
| 16–20 | Most critical workflows implemented including validation and error states; some secondary workflows |
| 21–25 | All critical + secondary workflows with edge case handling, business rules, and state transitions |

**Starter target: 8–13.** 2–3 core workflows working on the happy path. Example for POS: "add items → checkout" works, "void order" and "split bill" don't.

**How to verify:** List all workflows a production app would have (typically 8–15). Count how many the starter implements end-to-end. Workflow = a multi-step user journey that produces a business outcome.

---

### 3. CRUD + Validation Coverage (15 points)

How complete are the create/read/update/delete operations and input validation?

| Score | Description |
|:-----:|-------------|
| 0–3 | Read-only or single-entity create; no validation |
| 4–6 | Full CRUD for 1 entity; basic validation (required fields); other entities are read-only |
| 7–9 | Full CRUD for 2–3 key entities; type validation (email, number, date); partial validation on others |
| 10–12 | Full CRUD for all primary entities; field validation with error feedback; search on key fields |
| 13–15 | Full CRUD + validation for all entities; inline editing; bulk operations; cascading deletes |

**Starter target: 7–10.** Full CRUD for the 2–3 main entities with type-appropriate inputs and basic validation.

**How to verify:** For each entity, check: can you Create, Read (list+detail), Update, Delete? Does the form validate required fields, email format, number ranges?

---

### 4. Auth / Role Coverage (10 points)

How complete is the authentication and authorization model?

| Score | Description |
|:-----:|-------------|
| 0–2 | No auth, or login form exists but no role model |
| 3–4 | Login + register; single role; no route/action guards |
| 5–6 | Login + register; 2+ roles defined in `@auth`; route-level guards via `@nav` |
| 7–8 | Login + register; 2+ roles; route guards; role-based UI differences (some elements hidden per role) |
| 9–10 | Full RBAC with field-level permissions, role-specific dashboards, admin user management |

**Starter target: 5–7.** Login/register with 2–3 roles and route-level enforcement. `.air` can handle this natively with `@auth(required,role:enum(...))` and `@nav(/>?user>page:login)`.

**How to verify:** Can different roles see different pages? Does `@auth` block access? Are roles meaningful (not just labels)?

---

### 5. Search / Filter / Reporting Usefulness (10 points)

How useful are the data exploration and reporting features?

| Score | Description |
|:-----:|-------------|
| 0–2 | No search or filters |
| 3–4 | Basic text search on one field; no filters or sorting |
| 5–6 | Search + 1–2 category/status filters; basic stat cards |
| 7–8 | Search + filters + sort dropdown; dashboard with stats and charts; date range filtering |
| 9–10 | Advanced faceted search; paginated results; exportable reports; drill-down charts; date comparisons |

**Starter target: 4–6.** Search on primary fields, category/status filters, a few stat cards. `.air` supports `search:input>#search`, `tabs>filter.set(...)`, `stat:` widgets natively.

**How to verify:** Can you find specific records by name/id? Can you filter by category/status? Is there a dashboard with meaningful stats?

---

### 6. Seed / Sample Data Quality (10 points)

How demoable is the app out of the box?

| Score | Description |
|:-----:|-------------|
| 0–2 | No seed data; app starts empty |
| 3–4 | Minimal seed: 1–2 records per entity, no relationships populated |
| 5–6 | Realistic seed: 5–10 records per main entity, relationships populated, diverse enum values |
| 7–8 | Rich seed: 10+ records, realistic names/emails, various statuses, edge cases (empty descriptions, max-length names) |
| 9–10 | Production-like: 20+ records, realistic distributions, time-series data for charts, all relationship types exercised |

**Starter target: 5–7.** Enough data to demo every screen without empty states. Defined in `@seed` section or documented seed plan.

**How to verify:** Does every list/table show data on first load? Do charts have data? Are filter options exercised (items in each category)?

---

### 7. State Handling (5 points)

Are all four required states implemented?

| Score | Description |
|:-----:|-------------|
| 0–1 | Missing 2+ states |
| 2–3 | Has loading + error; missing empty or success |
| 4 | All four states present (empty, loading, error, success) on most pages |
| 5 | All four states on ALL pages/sections with contextual messages |

**Starter target: 5.** All bases already have this from Phase 3/4. Starters preserve it.

**How to verify:** Grep for `?loading>spinner`, `?error>alert:error`, `?!items>`, `alert:success` patterns.

---

### 8. Settings / Profile / Admin Basics (5 points)

Does the app have account management and configuration?

| Score | Description |
|:-----:|-------------|
| 0–1 | No profile or settings |
| 2 | Basic profile display (name, email, role) |
| 3 | Profile + sign out + basic settings page |
| 4 | Profile + settings with editable preferences + role display |
| 5 | Profile + settings + admin panel + user management |

**Starter target: 3–4.** Most bases already have profile/logout. Starters add a settings page with editable fields.

**How to verify:** Can the user see their profile? Change settings? Sign out?

---

### 9. `.air` Feasibility / Implementation Realism (5 points)

How well does the starter map to `.air` capabilities?

| Score | Description |
|:-----:|-------------|
| 0–1 | Core features require unsupported elements (drag-drop, real-time, rich text) |
| 2 | Major workarounds needed for 3+ features |
| 3 | 1–2 workarounds needed; most features native |
| 4 | All features implementable with documented patterns; workarounds are minor |
| 5 | Fully native `.air` implementation with no workarounds |

**Starter target: 3–4.** Most `.air` elements are native. Workarounds are documented and reasonable.

**How to verify:** Cross-reference with `capability_translation` from `base-template-specs.json`. Count workaround/unsupported items.

---

## Score Interpretation

| Score Range | Label | Meaning |
|:-----------:|-------|---------|
| 0–15 | Skeleton | Structural template only (Phase 4 bases) |
| 16–29 | Foundation | Has domain entities but no working workflows |
| **30–39** | **Starter (Low)** | **1–2 workflows, basic CRUD, needs significant work** |
| **40–50** | **Starter (Mid)** | **2–3 workflows, roles, search/filter, demoable** |
| 51–65 | Accelerator | Most workflows, rich data, approaching MVP |
| 66–80 | MVP | Feature-complete for core use case |
| 81–100 | Production | Polished, hardened, ready for users |

**Phase 4.5 target: all starters score 30–50 (Starter Low to Starter Mid).**

---

## Base Template Baseline Scores

All Phase 4 bases score approximately **12–16 points** (skeleton level):

| Criterion | Base score | Why |
|-----------|:---------:|-----|
| Domain model | 2–3 | Generic entities, minimal fields |
| Workflows | 1–2 | Pages exist but no connected workflows |
| CRUD | 2–3 | Basic forms exist, no validation |
| Auth | 3–5 | Login + roles defined |
| Search/filter | 1–2 | Search input exists |
| Seed data | 0 | No seed data |
| State handling | 5 | All four states present |
| Settings/profile | 2 | Basic profile/logout |
| Feasibility | 3–4 | Mostly native |
| **Total** | **~12–16** | **Skeleton level** |

Starters must add **18–34 points** to reach the 30–50 target range.

---

## Validation Appendix

**Phase 4 test command:**
```
npx vitest run
```

**Phase 4 test results:** 7 suites passed, 1 suite failed (pre-existing transpiler.test.ts module load error), 423 individual tests passed, 0 failed, 0 skipped.
