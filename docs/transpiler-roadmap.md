# Transpiler Roadmap: Starter-Ready

**Date**: 2026-02-24
**Goal**: Make the transpiler/runtime produce 30–50% app-ready starters without destabilizing existing base templates
**Strategy**: Incremental upgrades in 4 phases, ordered by impact on Batch 1 starters

---

## Phase T1: Unblock Batch 1 Starters (Minimal High-Impact)

**Goal**: Fix the 2 blockers + 2 high-severity gaps so Batch 1 starters can ship.
**Estimated effort**: Medium (3-4 focused modules)
**Backward-compat risk**: Low (additive changes, existing behavior preserved)

### T1.1: CRUD Pages Render .air UI Structure

**Gap**: GAP-04
**Affected code**: `src/transpiler/react/page-gen.ts` → `generateCrudPage()`

**Deliverables**:
1. When `hasAuthGating` is true, CRUD pages call `generateJSX()` on actual `@page` children instead of generic CRUD wrapper
2. Auto-generated handlers (load, handleCreate, handleUpdate, handleDelete) still injected as before
3. Undeclared state var detection still runs on the rendered JSX
4. Generic CRUD wrapper remains as fallback when page has no meaningful `.air` content (empty page body)

**Implementation approach**:
- In `generateCrudPage()`, check if `page.children` has substantive content (not just sidebar+main wrappers)
- If yes: render `.air` JSX via `generateJSX()`, inject data handlers above the return statement
- If no: fall back to current generic CRUD layout
- Auth-gated pages still receive `{ user, logout, currentPage, setCurrentPage }` props
- Auto-import `api.js` and add `load()`, `handleCreate()`, etc. based on detected model binding

**Test coverage**:
- New test: "auth-gated CRUD page renders .air UI structure"
- New test: "auth-gated CRUD page falls back to generic when no .air content"
- Existing tests must still pass (base templates generate identical output)

**Acceptance criteria**:
- `base-crud-admin.air` CRUD page includes search input, tabs, stat cards from `.air`
- Form fields derived from `.air` `input:` elements, not from model schema
- Custom detail views (`?selectedEntity>card(...)`) render correctly

---

### T1.2: Server Errors Surfaced to UI

**Gap**: GAP-03
**Affected code**: `src/transpiler/react/page-gen.ts` → `generateCrudPage()`, `generateDashboardPage()`

**Deliverables**:
1. Add `const [error, setError] = useState(null)` to CRUD and dashboard pages
2. In catch blocks: `setError(err.message || 'Operation failed')`
3. Auto-clear error on successful operations: `setError(null)` before try
4. Render error alert: `{error && <div className="alert-error">...{error}...</div>}` above content
5. Add success feedback for create/update: `const [successMsg, setSuccessMsg] = useState(null)` with auto-dismiss

**Implementation approach**:
- Add `error` and `successMsg` state to `declaredVars` in page generators
- Wrap existing catch blocks to `setError()` instead of `console.error()`
- After successful create/update: `setSuccessMsg('Created successfully')` + `setTimeout(() => setSuccessMsg(null), 3000)`
- Render both alerts above the main content area

**Test coverage**:
- New test: "CRUD page displays error on failed create"
- New test: "CRUD page displays success message on create"
- New test: "dashboard page displays error on failed load"

**Acceptance criteria**:
- Failed API call shows visible error message to user
- Successful create/update shows brief success indicator
- Error clears on next successful action

**Backward-compat risk**: None — adds new state vars that don't conflict with existing output.

---

### T1.3: Client-Side Form Validation (HTML5 + Required)

**Gap**: GAP-01 (partial — HTML5 layer)
**Affected code**: `src/transpiler/react/page-gen.ts` → `renderFormField()`, `src/transpiler/react/jsx-gen.ts`

**Deliverables**:
1. Add `required` attribute to form inputs when corresponding @db field has `:required` modifier
2. Add `type="email"` (already works), `type="number"` (already works) for browser-native validation
3. Add `minLength` attribute when field name suggests minimum (e.g., `name` → minLength=2)
4. Custom validation message via `title` attribute
5. In hand-authored `.air` forms (jsx-gen path): derive `required` from @db field lookup

**Implementation approach**:
- `renderFormField()` already receives `FormFieldInfo` — extend it with `required: boolean` and `minLength?: number`
- `buildFormFields()` in page-gen.ts: set `required: true` when db field has `:required` modifier (check `f.required`)
- In `jsx-gen.ts` for `input` elements: look up the bound state field (`>#entity.name`) → find matching @db field → apply `required` if `:required`
- Add `noValidate` is NOT set on `<form>` so browser validation fires

**Test coverage**:
- New test: "required attribute on inputs for required db fields"
- New test: "browser validation prevents submit for empty required fields"

**Acceptance criteria**:
- Required fields show browser-native validation popups
- Email fields validate format
- Number fields validate numeric input
- Submit blocked when required fields are empty

**Backward-compat risk**: Low — adds attributes that browsers previously ignored. Forms that worked before will still work; they just now also validate.

---

### T1.4: Forgot Password Flow

**Gap**: GAP-02
**Affected code**: `src/transpiler/react/mutation-gen.ts`, `src/transpiler/express/api-router-gen.ts`, `src/transpiler/react/page-gen.ts`

**Deliverables**:
1. Recognize `POST:/auth/forgot-password(email:str)>auth.forgotPassword` in API routes
2. Generate server handler: validate email exists, generate reset token (random hex), log to console, return success
3. Recognize `!forgotPassword` mutation in `findMatchingRoute()` — matches `POST:/auth/forgot-password`
4. Generate mutation handler: form-based, email validation, sets success/error state
5. When login page has `btn:ghost>"Forgot Password"` → wire navigation to forgotPassword page
6. When a `@page:forgotPassword` exists, generate it with email form + success/error states

**Implementation approach**:
- In `mutation-gen.ts:findMatchingRoute()`: add case for `forgotPassword` / `resetPassword` → match `forgot-password` endpoint
- In `api-router-gen.ts`: detect `auth.forgotPassword` handler → generate token stub
- Login page: auto-detect if forgot-password route exists → inject link below form
- If no explicit `@page:forgotPassword` in `.air`, auto-generate a minimal one

**Test coverage**:
- New test: "forgot password route generates server handler"
- New test: "forgot password mutation wires to API call"
- New test: "login page includes forgot password link when route exists"

**Acceptance criteria**:
- Login page shows "Forgot Password?" link
- Clicking it navigates to forgot password page
- Email form validates email is required
- Success message: "If an account exists for that email, a reset link has been sent"
- Error state for invalid email
- "Back to Login" link

**Backward-compat risk**: Low — only activates when `forgot-password` route is defined in @api. Existing templates without it are unaffected.

---

### T1.5: Improved Mutation Wiring

**Gap**: GAP-08
**Affected code**: `src/transpiler/react/mutation-gen.ts` → `findMatchingRoute()`, `findGenericRouteMatch()`

**Deliverables**:
1. Extract model name from mutation name: `!createTicket` → model "Ticket" → find `POST:/tickets`
2. Extract action from mutation name: `!resolveTicket` → action "resolve" on model "Ticket" → find `PUT:/tickets/:id`
3. Support compound mutations: `!updateOrderStatus` → model "Order", action "updateStatus" → find `PUT:/orders/:id`
4. For mutations with arguments like `!assignAgent(#ticket.id)`, use argument hint to disambiguate

**Implementation approach**:
- In `findGenericRouteMatch()`: before kebab-case conversion, try splitting camelCase into [verb][Model] pattern
- Map verb to HTTP method: create→POST, update/resolve/assign/close→PUT, delete/remove→DELETE
- Map Model to route path: Ticket→/tickets, Order→/orders
- Fall back to existing kebab-case matching if pattern matching fails

**Test coverage**:
- New test: "createTicket mutation matches POST:/tickets"
- New test: "resolveTicket mutation matches PUT:/tickets/:id"
- New test: "mutation with model hint in args matches correct route"

**Acceptance criteria**:
- Domain-specific mutations in starters wire to correct API endpoints
- No existing mutation matching is broken

**Backward-compat risk**: Low — additive matching. Existing patterns checked first; new matching is fallback.

---

### T1.6: Cancel Button on Auth Forms

**Gap**: GAP-06
**Affected code**: `src/transpiler/react/mutation-gen.ts`

**Deliverables**:
1. Recognize `!cancel`, `!cancelLogin`, `!goBack` mutations
2. Wire to: clear form fields + optional page navigation (back to previous page or stay on current)

**Implementation approach**:
- Add to mutation generator: `const cancel = (e) => { e?.target?.closest('form')?.reset(); }`
- Or simpler: `!cancel` → `setCurrentPage('login')` (navigate) or form reset

**Test coverage**:
- New test: "cancel mutation generates form reset"

**Acceptance criteria**:
- Cancel button clears form and/or navigates away
- No dead button

**Backward-compat risk**: None — new mutation name, doesn't affect existing mutations.

---

## Phase T2: Form/Validation Ergonomics

**Goal**: Production-like form UX — inline errors, confirm password, smarter seed data.
**Estimated effort**: Medium
**Backward-compat risk**: Low

### T2.1: Inline Field-Level Error Rendering

**Gap**: GAP-01 (complete)
**Affected code**: `src/transpiler/react/page-gen.ts`, `src/transpiler/react/jsx-gen.ts`

**Deliverables**:
1. Add `formErrors` state object: `{ fieldName: 'error message' }`
2. Client-side validation function generated per form (derived from @db field types + modifiers)
3. Render error text below each field: `{formErrors.email && <p className="text-red-500 text-xs">{formErrors.email}</p>}`
4. `aria-invalid` attribute on invalid fields
5. Form-level validation runs on submit before API call
6. Clears field error on input change

**Implementation approach**:
- Generate `validateForm(data)` function per form, derived from db model constraints
- Rules: required check, email regex for email fields, min/max length, numeric range
- On submit: run `validateForm()` first, set `formErrors` state, prevent API call if errors
- On input change: clear that field's error

**Test coverage**:
- New test: "inline error shown for empty required field"
- New test: "inline error shown for invalid email format"
- New test: "error clears on input change"

**Acceptance criteria**: All 10 validation requirements from Phase 4.5B spec met for auto-generated forms.

---

### T2.2: Confirm Password on Register

**Gap**: GAP-07
**Affected code**: `src/transpiler/react/mutation-gen.ts`

**Deliverables**:
1. Detect when register form has two password-type inputs
2. Auto-inject: `if (formData.password !== formData.confirmPassword) { setAuthError('Passwords do not match'); return; }`

**Test coverage**: New test: "register with mismatched passwords shows error"

---

### T2.3: Textarea Element

**Gap**: GAP-09
**Affected code**: `src/transpiler/element-map.ts`

**Deliverables**:
1. Add `textarea` entry to `ELEMENT_MAP`: `{ tag: 'textarea', className: '...', rows: 4 }`
2. Support `input:textarea` modifier as alias

**Test coverage**: New test: "textarea element generates <textarea> tag"

---

### T2.4: Smarter Seed Data

**Gap**: GAP-05
**Affected code**: `src/transpiler/seed-gen.ts`

**Deliverables**:
1. Use model name + field name context for realistic data
2. Product.name → "Wireless Headphones", "Organic Coffee Beans", etc.
3. Ticket.subject → "Login page broken", "Billing inquiry", etc.
4. Configurable record count via `@seed(Model:count)` or convention-based (10 for primary models, 5 for junction)

**Test coverage**: New test: "seed data uses domain-specific values for known model patterns"

---

### T2.5: Bcrypt Password Hashing

**Gap**: GAP-12
**Affected code**: `src/transpiler/seed-gen.ts`, `src/transpiler/express/api-router-gen.ts`

**Deliverables**:
1. Add `bcryptjs` to generated server `package.json`
2. Seed: `await bcrypt.hash('password1', 10)`
3. Login: `await bcrypt.compare(password, user.password)`

**Test coverage**: Existing auth tests updated.

---

## Phase T3: Reuse/Composition & Maintainability

**Goal**: Reduce `.air` verbosity, support more layout types.
**Estimated effort**: Medium-Large
**Backward-compat risk**: Medium (layout changes affect rendered output)

### T3.1: Layout Type Variants

**Gap**: GAP-10
**Affected code**: `src/transpiler/react/layout-gen.ts`

**Deliverables**:
1. Detect layout type from `.air` structure: sidebar → sidebar layout, header(nav) → top-bar layout, footer(nav) → bottom-tab layout
2. Generate appropriate Layout.jsx variant
3. Pages no longer need to duplicate nav elements

**Test coverage**: New tests for each layout variant.

### T3.2: URL Input Type

**Gap**: GAP-11
**Affected code**: `src/transpiler/element-map.ts`

**Deliverables**: Add `url` input modifier → `type="url"`.

### T3.3: Shared Section Extraction

Detect repeated patterns across pages (e.g., header nav, footer nav) and auto-extract into shared component.

---

## Phase T4: Performance + DX Hardening

**Goal**: Ensure transpile speed, startup time, and developer experience meet production bar.
**Estimated effort**: Small-Medium
**Backward-compat risk**: None

### T4.1: Transpile Time Budget

- Current: ~11ms for base-crud-admin (180 lines → 30 files)
- Target: <200ms for any starter (300-500 lines → 50+ files)
- Benchmark: Add starter-sized fixtures to bench.test.ts

### T4.2: Generated App Startup Time

- Target: Vite dev server starts in <3s
- Target: First meaningful paint in <2s
- Measurement: Add to doctor.ts diagnostics

### T4.3: Edit-Refresh Loop

- Current: `air dev` watches `.air` file → retranspiles → Vite HMR picks up
- Target: <1s from `.air` save to browser update
- No changes needed if transpile stays under 200ms

### T4.4: Error Messages for Common .air Mistakes

- Improve parser error messages for common syntax errors
- Add "did you mean?" suggestions for misspelled elements

---

## Phase Summary

| Phase | Deliverables | Gaps Closed | Risk | Prerequisite |
|-------|-------------|-------------|------|-------------|
| **T1** | 6 items: CRUD UI restore, error surfacing, HTML5 validation, forgot password, mutation wiring, cancel | GAP-01 (partial), GAP-02, GAP-03, GAP-04, GAP-06, GAP-08 | Low | None |
| **T2** | 5 items: inline errors, confirm password, textarea, smart seed, bcrypt | GAP-01 (complete), GAP-05, GAP-07, GAP-09, GAP-12 | Low | T1 |
| **T3** | 3 items: layout variants, URL input, shared sections | GAP-10, GAP-11 | Medium | T2 |
| **T4** | 4 items: perf budgets, startup time, edit loop, error messages | — | None | T1 |

**Batch 1 starters require T1 completion minimum. T2 upgrades significantly improve quality but aren't blocking.**
