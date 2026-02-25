# Starter Capability Matrix

**Date**: 2026-02-24
**Purpose**: Map required starter capabilities to current transpiler support status
**Evidence base**: Source analysis of `src/transpiler/`, generated output from base templates

---

## Support Level Legend

| Level | Meaning |
|-------|---------|
| **full** | Works end-to-end in generated output, no changes needed |
| **partial** | Partially works but missing important behavior |
| **workaround** | Achievable with creative `.air` patterns or minor transpiler tweaks |
| **unsupported** | Not possible without transpiler changes |

---

## Capability Matrix

### A. Authentication & Authorization

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| Email + password login form | **full** | `mutation-gen.ts:337-401` — generates working login with FormData, API call, token storage, redirect | — |
| Auth error display (form-level) | **full** | `jsx-gen.ts:280-284` — auto-injects `{authError && <div>...}` inside auth forms | — |
| Loading state during auth submit | **full** | `mutation-gen.ts:341,370-373` — `setLoading(true/false)` wraps auth calls | — |
| Registration form | **full** | `mutation-gen.ts:420-471` — generates register handler with email/password validation | — |
| Logout | **full** | `mutation-gen.ts:403-419` — clears token, localStorage, redirects to login | — |
| Role-based route guards | **full** | `@auth(required,role:enum(...))` + `@nav(/>?user>page:login)` — works natively | — |
| Forgot password flow | **unsupported** | No `forgotPassword` mutation, no reset endpoint, no reset page | GAP-02 |
| Cancel button on login | **workaround** | Can add `btn:ghost>"Cancel"` in `.air` but `!cancel` mutation not recognized | GAP-06 |
| Confirm password field | **unsupported** | Transpiler doesn't cross-validate two password fields | GAP-07 |
| Role-based UI gating (element-level) | **partial** | Route-level gating works; element-level `?user.role==admin>` not supported (no `==`) | — |

### B. Form Validation

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| Required field validation (client) | **unsupported** | No `required` attribute on form inputs; no client-side check | GAP-01 |
| Type/format validation (email, number) | **partial** | `input:email` → `type="email"` (browser validates), but no explicit error | GAP-01 |
| Length validation (min/max) | **unsupported** | No `minlength`/`maxlength` attributes generated | GAP-01 |
| Range validation (numeric) | **unsupported** | No `min`/`max` attributes on number inputs | GAP-01 |
| Enum/allowed value validation | **partial** | `<select>` with enum values constrains input; no custom validation message | — |
| Cross-field validation | **unsupported** | No mechanism to compare two fields (e.g., password match) | GAP-07 |
| Server-side type validation | **full** | `validateFields()` checks typeof for each param | — |
| Server-side required field check | **full** | `assertRequired()` checks presence | — |
| Inline field error rendering | **unsupported** | No per-field error display; only form-level auth error | GAP-01 |
| Submit prevention when invalid | **unsupported** | Forms submit regardless of validation state | GAP-01 |
| Focus/scroll to first invalid field | **unsupported** | No focus management in generated code | GAP-01 |
| Success feedback after submit | **partial** | Auth forms redirect on success; CRUD forms reload data but no success message | GAP-03 |
| Error feedback after submit | **partial** | Auth forms show error; CRUD forms silently fail (console.error) | GAP-03 |

### C. Form UX

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| Form labels | **full** | `wrapFormGroup()` in jsx-gen + page-gen both generate labels | — |
| Placeholder text | **full** | Auto-generated from field name: "Enter email...", "Enter name..." | — |
| Input types (text, email, password, number, date) | **full** | `element-map.ts:77-83` — 5 types mapped | — |
| Textarea (multi-line) | **partial** | Auto-generated in CRUD pages from field name heuristic; not in hand-authored `.air` forms | GAP-09 |
| Select dropdowns (enum) | **full** | `page-gen.ts:719-726` — generates `<select>` with `<option>` for enum fields | — |
| Checkbox inputs | **full** | `page-gen.ts:727-731` — generates checkbox for bool fields | — |
| Date inputs | **full** | `page-gen.ts:164` — maps datetime fields to `input:date` | — |
| Form reset after submit | **full** | `page-gen.ts:535` — `e.target.reset()` after create | — |
| Submitting state indicator | **full** | `page-gen.ts:485-487` — `submitting` state, disabled button, "Creating..." text | — |
| Loading skeleton | **full** | `page-gen.ts:627-634` — animated pulse skeleton during load | — |

### D. CRUD Operations

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| Create (form-based) | **full** | `page-gen.ts:522-545` — `handleCreate` with form extraction, API call, refetch | — |
| Read (list view) | **full** | `page-gen.ts:637-683` — item list with truncated fields | — |
| Update (edit form) | **partial** | `editId` state exists but no edit form rendered — only edit button that sets ID | GAP-04 |
| Delete (with confirmation) | **full** | `page-gen.ts:688-703` — modal confirmation dialog, delete handler | — |
| Empty state | **full** | `page-gen.ts:638-648` — "No items yet" with icon and description | — |
| Search | **partial** | Server-side search via query params works; but CRUD page doesn't render search input | GAP-04 |
| Filter tabs | **unsupported** | CRUD page ignores `.air` tabs/filter elements | GAP-04 |
| Sort | **partial** | Server API supports `?sort=field:asc` but no UI generated | GAP-04 |
| Pagination | **partial** | Server returns `X-Total-Count` + meta; client doesn't render paginator | GAP-04 |

### E. State Handling

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| Empty state | **full** | All base templates have `?!items>card("No items yet")` pattern | — |
| Loading state (spinner) | **full** | `?loading>spinner` pattern + CRUD page skeleton animation | — |
| Error state (alert) | **partial** | Auth pages show error; CRUD pages don't surface server errors | GAP-03 |
| Success state | **partial** | Auth redirects on success; CRUD refetches but no success message | GAP-03 |

### F. Navigation & Routing

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| Page-based routing | **full** | `@nav` → `currentPage` state + conditional rendering | — |
| Auth-gated routes | **full** | `@nav(/>?user>page:login)` pattern works | — |
| Post-login redirect | **full** | `getPostLoginPage()` finds dashboard/home/first-non-auth page | — |
| Page transitions | **full** | `animate-fade-in` class on page content | — |
| Sidebar navigation | **full** | `layout-gen.ts` generates responsive sidebar with icons, active state, mobile collapse | — |
| Top-bar navigation | **workaround** | Must duplicate `header(nav(...))` per page in `.air` | GAP-10 |
| Bottom-tab navigation | **workaround** | Must duplicate `footer(nav(...))` per page in `.air` | GAP-10 |
| Breadcrumbs | **unsupported** | No breadcrumb element or auto-generation | — |

### G. Data & API

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| REST API generation | **full** | `api-router-gen.ts` — full CRUD routes with Prisma | — |
| API client generation | **full** | `api-client-gen.ts` — typed fetch wrappers with token auth | — |
| JWT authentication | **full** | `server/auth.ts` — HMAC-SHA256 createToken/verifyToken/requireAuth | — |
| Prisma schema from @db | **full** | `prisma.ts` — models, relations, enums, indexes, cascades | — |
| Seed data generation | **partial** | 5 records per model with generic data; no customization | GAP-05 |
| FK-safe seeding | **full** | Topological sort, sequential creates, m:n connect | — |
| Request validation | **full** | `validateFields()` + `assertRequired()` in generated server | — |
| Error classification middleware | **full** | Prisma errors, 404s, validation errors properly classified | — |
| CORS + security headers | **full** | helmet, express.json limit, CORS config generated | — |

### H. UI Components

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| Stat cards | **full** | `stat:"Label">#value` → responsive grid | — |
| Charts (placeholder) | **full** | `chart:line`, `chart:bar` → placeholder div with label | — |
| Tables | **full** | `table>data>*row(...)` → styled table with headers | — |
| Card grid | **full** | `grid:3>items>*item(card(...))` → responsive grid | — |
| Badges | **full** | `badge:#status` → colored pill | — |
| Alerts (error/success/warning/info) | **full** | `alert:error`, `alert:success` etc. | — |
| Accordion (details/summary) | **full** | `details(summary>...+content)` → native HTML details | — |
| Progress bar | **full** | `progress:bar>#value` → animated bar | — |
| Tabs | **full** | `tabs>filter.set(a,b,c)` → tab buttons with active state | — |
| Modal dialog | **partial** | Delete confirmation modal generated; no general modal support | — |
| Tooltip | **unsupported** | No tooltip element in AIR | — |

### I. Workflow Behavior

| Capability | Status | Evidence | Gap # |
|-----------|--------|----------|-------|
| End-to-end CRUD workflow | **partial** | Create + Read + Delete work; Update form not rendered in auth-gated mode | GAP-04 |
| Auth workflow (login → redirect) | **full** | Login → API call → set token → set user → redirect to dashboard | — |
| Auth workflow (register → login) | **full** | Register → API call → redirect to login page | — |
| Custom mutation wiring | **partial** | 30 action verbs recognized + camelCase→kebab matching; custom names may miss | GAP-08 |
| Workflow chaining (multi-step) | **workaround** | Use separate `@page:` entries (like wizard) — works but verbose | — |
| Optimistic updates | **unsupported** | All mutations use refetch-after-success pattern | — |
| Real-time updates | **unsupported** | No WebSocket/SSE support | — |

---

## Batch 1 Starter Impact Summary

### saas-admin (crud-admin base)
- **Blocked by**: GAP-01 (no form validation), GAP-02 (no forgot password), GAP-04 (CRUD ignores .air UI)
- **Degraded by**: GAP-03 (silent errors), GAP-08 (mutation wiring for invite/deactivate)
- **OK**: Auth flow, layout/sidebar, role-based routing

### help-desk (inbox base)
- **Blocked by**: GAP-01, GAP-02, GAP-04
- **Degraded by**: GAP-03, GAP-08 (mutation wiring for resolveTicket/assignAgent), GAP-09 (textarea for message body)
- **OK**: Auth flow, three-pane layout (via sidebar+sections)

### ecommerce-store (storefront base)
- **Blocked by**: GAP-01, GAP-02
- **Degraded by**: GAP-03, GAP-04 (checkout form, admin pages), GAP-05 (generic product names)
- **OK**: Auth flow, public shop page, cart persistence, category tabs
