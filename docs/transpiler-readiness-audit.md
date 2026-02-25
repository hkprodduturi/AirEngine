# Transpiler Readiness Audit

**Date**: 2026-02-24
**Scope**: Evaluate current transpiler/runtime against Phase 4.5B starter quality bar
**Method**: Source code analysis of `src/transpiler/`, generated output inspection, comparison against starter-specs.json requirements
**Evidence base**: 20 base templates, 10 starter specs, starter-readiness-rubric (0–100)

---

## Executive Summary

The transpiler produces functional fullstack apps (React + Tailwind + Express + Prisma) with working auth, CRUD pages, layout/sidebar, and seed data. For base templates (structural shells), this is sufficient. For starters that must feel "30–50% app-ready with usable end-to-end flows," there are **7 significant gaps** and **5 moderate gaps**.

**Overall verdict**: Incremental upgrades can close all gaps. No rewrite needed. The transpiler architecture is sound — gaps are in generated output completeness, not in fundamental design.

---

## Gap Classification Legend

| Type | Meaning |
|------|---------|
| **syntax** | AIR language cannot express it well |
| **transpiler** | AIR can express it, transpiler output is insufficient |
| **runtime** | Generated app behavior/integration missing |
| **scaffold** | Build/config/infrastructure missing |
| **docs** | Feature exists but not well-documented/usable |
| **non-goal** | Out of scope for AIR's design |

| Severity | Meaning |
|----------|---------|
| **blocker** | Cannot ship Batch 1 starters without fixing |
| **high** | Significantly degrades starter quality |
| **medium** | Noticeable quality gap, workaround exists |
| **low** | Nice-to-have, not critical |

---

## GAP-01: No Client-Side Form Validation

| Field | Value |
|-------|-------|
| **Type** | transpiler |
| **Severity** | **blocker** |
| **Affected starters** | ALL (saas-admin, help-desk, ecommerce-store) |

### Current behavior
- Forms use uncontrolled inputs with `FormData` extraction
- Login/register forms have hardcoded check: `if (!formData.email || !formData.password)`
- No `required` attribute on form inputs
- No format validation (email regex, min/max length, numeric range)
- No inline error messages per field
- No submit prevention when form is invalid
- Server validates with `validateFields()` but errors are caught in `catch(err)` and only logged to console

### Evidence
- `src/transpiler/react/mutation-gen.ts:346-349`: Login validation is hardcoded, not derived from @db schema
- `src/transpiler/react/page-gen.ts:612-625`: CRUD form has no validation — raw FormData submitted directly
- `src/transpiler/react/jsx-gen.ts:270-286`: Form element generates `<form onSubmit>` with no validation layer
- Generated `EntitiesPage.jsx`: `handleCreate` does `Object.fromEntries(new FormData(e.target))` → `await api.createEntity(fd)` with no field checks

### Impact
- Forms silently submit invalid data
- Server returns 400 but client doesn't display error to user (just `console.error`)
- No "required field" indicators, no inline errors
- Fails 8 of 10 validation requirements from Phase 4.5B spec

### Workaround viability
**Medium** — Can add `required` attributes and basic HTML5 validation in `.air` via `input:email:required`. But `.air` syntax doesn't currently support `:required` on UI inputs (only on @db fields). The transpiler would need to either:
1. Auto-derive `required` from @db field modifiers (recommended)
2. Add new syntax like `input:email:required`

### Recommended fix
**Phase T1**: Auto-inject HTML5 validation attributes from @db schema:
- `:required` → `required` attribute
- `:email` fields → `type="email"` (already works) + `required`
- Enum fields → `required` on `<select>`
- Display server error responses in form-level alert (not just console.error)

**Phase T2**: Add inline field-level error rendering with `aria-invalid` and error text beneath inputs.

---

## GAP-02: No Forgot Password Flow

| Field | Value |
|-------|-------|
| **Type** | transpiler + runtime |
| **Severity** | **blocker** |
| **Affected starters** | ALL |

### Current behavior
- Login page has email + password + "Sign In" button only
- No "Forgot Password" link/button
- No `POST:/auth/forgot-password` route generated
- No `POST:/auth/reset-password` route generated
- No reset token generation or email stub
- No separate page for password reset flow

### Evidence
- `src/transpiler/react/mutation-gen.ts:337-401`: Only `login`, `logout`, `register` are recognized auth mutations
- `src/transpiler/express/api-router-gen.ts`: Only generates routes for `auth.login` and `auth.register` handlers
- No mention of `forgot`, `reset`, `recover` in any transpiler file

### Impact
- Login page doesn't meet minimum auth screen requirements from Phase 4.5B spec
- Missing: Forgot Password link, loading state, email validation, confirmation message
- Production-like auth UX is a hard gate

### Workaround viability
**Low** — The `.air` format CAN express the UI elements (a button, a page, a form), but the transpiler won't wire `!forgotPassword` to a working server endpoint. The entire flow (token generation, email stub, reset page) must be generated.

### Recommended fix
**Phase T1**:
1. Recognize `POST:/auth/forgot-password(email:str)>auth.forgotPassword` in @api
2. Generate server stub that logs reset token to console (email integration out of scope)
3. Recognize `!forgotPassword` mutation → form-based, sets success/error state
4. Add `@page:forgotPassword` rendering support
5. Login page: auto-inject "Forgot Password?" link when forgot-password route exists

---

## GAP-03: Server Errors Not Surfaced to UI

| Field | Value |
|-------|-------|
| **Type** | transpiler |
| **Severity** | **high** |
| **Affected starters** | ALL |

### Current behavior
- Auth-gated CRUD pages: `handleCreate`, `handleUpdate`, `handleDelete` have `catch(err) { console.error(err); }` — no user feedback
- Dashboard pages: errors caught but not displayed
- Non-auth forms: errors logged to console only
- Auth forms: errors properly displayed via `authError` state ✓

### Evidence
- `src/transpiler/react/page-gen.ts:526-544`: `handleCreate` catches error but only `console.error(err)`
- `src/transpiler/react/page-gen.ts:548-566`: `handleUpdate` same pattern
- `src/transpiler/react/page-gen.ts:569-580`: `handleDelete` same pattern
- `src/transpiler/react/mutation-gen.ts:243-244`: Generic `add` mutation: `console.error('add failed:', err)`

### Impact
- User submits form → server rejects → user sees nothing (silent failure)
- Breaks "actionable feedback to user" and "no dead buttons" requirements

### Workaround viability
**High** — Simple to fix: add `error` state to CRUD pages, set it in catch blocks, render `alert:error` in form area.

### Recommended fix
**Phase T1**: Add `const [error, setError] = useState(null)` to CRUD pages, surface in catch blocks, render error alert above form.

---

## GAP-04: CRUD Page Ignores .air UI Structure

| Field | Value |
|-------|-------|
| **Type** | transpiler |
| **Severity** | **high** |
| **Affected starters** | saas-admin, help-desk, ecommerce-store |

### Current behavior
When `hasAuthGating` is true (which it is for all starters), CRUD pages are generated entirely by `generateCrudPage()` which:
1. Ignores the `@page` JSX from the `.air` file
2. Generates its own generic list/form layout based on model fields
3. Shows only first 3 fields in list view
4. No search, no filter tabs, no stat cards, no custom layout

### Evidence
- `src/transpiler/react/page-gen.ts:449-710`: `generateCrudPage()` builds hardcoded UI — never calls `generateJSX()` on the actual page children from `.air`
- `src/transpiler/react/page-gen.ts:591`: Comment says "skip the @ui block JSX since the wrapper already handles display"
- The carefully authored `.air` UI (search bars, tabs, stat grids, custom detail views) is discarded

### Impact
- All the custom UI in starter `.air` files (search, filters, stat dashboards, detail panels) would be thrown away
- Starters would look identical to each other (generic CRUD list)
- Defeats the purpose of authoring domain-specific `.air` templates

### Workaround viability
**Low** — The only workaround is to make starters NOT trigger auth-gating (remove `@auth` or login page), which defeats the purpose.

### Recommended fix
**Phase T1**: For CRUD pages in auth-gated mode, render the `.air` UI structure instead of the generic CRUD wrapper. Use `generateJSX()` on page children, and supplement with auto-generated handlers (load, create, update, delete) from model binding. This is the most impactful single fix.

---

## GAP-05: No Seed Data Customization

| Field | Value |
|-------|-------|
| **Type** | transpiler |
| **Severity** | **medium** |
| **Affected starters** | ALL |

### Current behavior
- `seed-gen.ts` generates 5 records per model with generic data
- Names: "Alice", "Bob", "Charlie", "Diana", "Eve" (person models) or "Model 1", "Model 2" (others)
- Emails: `user1@example.com`, `user2@example.com`
- No domain-specific data (no product names, ticket subjects, order details)
- No control over record count per model

### Evidence
- `src/transpiler/seed-gen.ts:1-8`: Fixed 5 records per model
- Starter specs define custom counts: e.g., ecommerce wants 15 products, 5 orders, 12 order items

### Impact
- Demo experience is generic rather than domain-specific
- Rubric criterion "Seed/Sample Data Quality" scores 3-4/10 instead of target 5-7

### Workaround viability
**Medium** — Users can manually edit the generated `seed.ts` file. But for "time-to-working-app" this adds friction.

### Recommended fix
**Phase T2**: Add optional `@seed` block to `.air` syntax OR allow seed count/data hints in `@db` model comments. Alternatively, improve heuristic: use model name context for smarter data (Product → "Wireless Headphones", Ticket → "Login page broken").

---

## GAP-06: No Cancel Button on Login/Register

| Field | Value |
|-------|-------|
| **Type** | transpiler |
| **Severity** | **medium** |
| **Affected starters** | ALL |

### Current behavior
- Login page has only "Sign In" button
- No "Cancel" button to dismiss/clear the form
- No loading state indicator on the submit button itself (loading spinner exists as a separate element but button text doesn't change)

### Evidence
- Generated `LoginPage.jsx`: Single submit button, no cancel
- `.air` can express `btn:ghost>"Cancel">!cancelLogin` but it won't wire to anything meaningful

### Impact
- Missing required auth screen element from Phase 4.5B spec
- Minor UX gap — users can navigate away, but explicit cancel is expected

### Workaround viability
**High** — Add `btn:ghost>"Cancel"` to `.air` login form. Transpiler just needs to wire it to form reset or page navigation.

### Recommended fix
**Phase T1**: Recognize `!cancel` / `!cancelLogin` mutation as form reset + optional navigation.

---

## GAP-07: Register Form Missing Confirm Password

| Field | Value |
|-------|-------|
| **Type** | syntax + transpiler |
| **Severity** | **medium** |
| **Affected starters** | ALL with registration |

### Current behavior
- Register mutation accepts `formData.email, formData.password`
- No confirm password field
- No cross-field validation (password === confirmPassword)

### Evidence
- `src/transpiler/react/mutation-gen.ts:420-471`: Register handler validates `!formData.email || !formData.password` but no confirm check
- `.air` can express `input:password>#confirmPassword` but transpiler won't validate it against password

### Impact
- Fails "cross-field validation" requirement
- Minor for Batch 1 but expected for production-like auth

### Workaround viability
**High** — Can add client-side check in register handler: `if (formData.password !== formData.confirmPassword)`

### Recommended fix
**Phase T2**: When register form has two password inputs, auto-inject confirm validation.

---

## GAP-08: Generic Mutation Wiring Fragile

| Field | Value |
|-------|-------|
| **Type** | transpiler |
| **Severity** | **medium** |
| **Affected starters** | ALL |

### Current behavior
- `findMatchingRoute()` matches mutations by hardcoded name patterns: `add`, `del`, `toggle`, `login`, `register`, `logout`, `update`, `save`, `archive`, `done`
- `findGenericRouteMatch()` converts camelCase to kebab-case for lookup
- Custom mutations like `!createTicket`, `!assignAgent`, `!updateOrderStatus` may or may not match depending on route path naming
- Action verbs list is finite: 30 verbs hardcoded

### Evidence
- `src/transpiler/react/mutation-gen.ts:65-132`: Hardcoded mutation matching
- `src/transpiler/react/mutation-gen.ts:193-199`: Finite action verb list
- Starter specs define custom workflows: `!submitTicket`, `!resolveTicket`, `!placeOrder`, `!inviteUser`

### Impact
- Starters with domain-specific mutations may get no-op handlers
- Buttons would fire but nothing happens (silent failure)

### Workaround viability
**Medium** — Name mutations to match existing patterns (e.g., `!add` instead of `!createTicket`). But this makes `.air` files less readable.

### Recommended fix
**Phase T1**: Improve generic route matching — if mutation name contains a model name + action verb, match to corresponding route. e.g., `!createTicket` → `POST:/tickets`.

---

## GAP-09: No `textarea` Input Type in .air

| Field | Value |
|-------|-------|
| **Type** | syntax |
| **Severity** | **low** |
| **Affected starters** | help-desk (message body), ecommerce-store (reviews) |

### Current behavior
- `input:text` generates `<input type="text" />` (single line)
- No `input:textarea` or equivalent in element-map
- Page-gen.ts auto-detects textarea from field names (`description`, `notes`, `body`, `content`) but only in generated CRUD forms

### Evidence
- `src/transpiler/element-map.ts:77-83`: Only text, number, email, password, search modifiers
- `src/transpiler/react/page-gen.ts:169`: `fieldTypeToInputType` maps description/notes/body/content → textarea

### Impact
- Multi-line text fields in `.air` UI render as single-line inputs
- Works in auto-generated CRUD (page-gen detects it) but not in hand-authored `.air` forms

### Workaround viability
**High** — Add `textarea` to element-map as a new element or `input:textarea` modifier.

### Recommended fix
**Phase T2**: Add `textarea` element to element-map.ts. Map to `<textarea>` with standard classes.

---

## GAP-10: Layout Duplication for Non-Sidebar Templates

| Field | Value |
|-------|-------|
| **Type** | transpiler |
| **Severity** | **low** |
| **Affected starters** | ecommerce-store (top-bar nav), help-desk (three-pane) |

### Current behavior
- Layout.jsx always generates a sidebar-style navigation
- Templates with `top-bar` nav (storefront) or custom layouts must duplicate header nav across pages
- No mechanism to specify layout type (sidebar vs top-bar vs bottom-tabs)

### Evidence
- `src/transpiler/react/layout-gen.ts:53-57`: Only generates sidebar layout
- `base-storefront.air`: Duplicates `header(nav(...))` on every page (4 copies)
- `base-feed.air`: Duplicates `footer(nav(...))` on every page (4 copies)

### Impact
- `.air` files are larger than necessary (repeated nav code)
- Generated output has duplicated nav HTML across pages
- Not a functional blocker — apps work correctly, just verbose

### Workaround viability
**High** — Duplication is the current pattern and it works. Each page is self-contained.

### Recommended fix
**Phase T3**: Add layout type variants (sidebar, top-bar, bottom-tabs) to Layout.jsx generation. Low priority since duplication works.

---

## GAP-11: No `input:url` Type

| Field | Value |
|-------|-------|
| **Type** | syntax |
| **Severity** | **low** |
| **Affected starters** | ecommerce-store (image_url), online-marketplace (image_url) |

### Current behavior
- No `input:url` modifier
- URL fields render as `input:text`

### Evidence
- `src/transpiler/element-map.ts:77-83`: Only 5 input modifiers defined

### Impact
- No browser-native URL validation on URL inputs

### Workaround viability
**High** — Use `input:text` with manual validation hint. URL validation is not critical for starters.

### Recommended fix
**Phase T3**: Add `url` and `date` (already exists) input modifiers.

---

## GAP-12: Seed Data Password Handling

| Field | Value |
|-------|-------|
| **Type** | runtime |
| **Severity** | **medium** |
| **Affected starters** | ALL |

### Current behavior
- Seed generates `password: 'password1'` in plaintext
- Server login route compares with `if (user.password !== password)` (plaintext check)
- Comment says `// TODO: replace with bcrypt.compare() for production`

### Evidence
- Generated `api.ts`: `if (user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });`
- Generated `seed.ts`: passwords stored in plaintext

### Impact
- Works for demo purposes but looks unprofessional
- Starter quality bar says "production-like form behavior"

### Workaround viability
**High** — This is intentional for simplicity. Adding bcrypt would require a dependency and async hashing in seed.

### Recommended fix
**Phase T2**: Add bcrypt hashing in seed + login. Or document plaintext as intentional demo simplification with a TODO comment.

---

## Summary Table

| # | Gap | Type | Severity | Fix Phase |
|---|-----|------|----------|-----------|
| 01 | No client-side form validation | transpiler | **blocker** | T1 |
| 02 | No forgot password flow | transpiler+runtime | **blocker** | T1 |
| 03 | Server errors not surfaced to UI | transpiler | **high** | T1 |
| 04 | CRUD page ignores .air UI structure | transpiler | **high** | T1 |
| 05 | No seed data customization | transpiler | medium | T2 |
| 06 | No cancel button on login | transpiler | medium | T1 |
| 07 | Register missing confirm password | syntax+transpiler | medium | T2 |
| 08 | Generic mutation wiring fragile | transpiler | medium | T1 |
| 09 | No textarea input type in .air | syntax | low | T2 |
| 10 | Layout duplication for non-sidebar | transpiler | low | T3 |
| 11 | No input:url type | syntax | low | T3 |
| 12 | Seed data password handling | runtime | medium | T2 |

**Blockers**: 2 (must fix before Batch 1)
**High**: 2 (should fix before Batch 1)
**Medium**: 5 (fix in T1-T2)
**Low**: 3 (defer to T3)
