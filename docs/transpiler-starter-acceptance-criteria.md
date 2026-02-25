# Transpiler Starter Acceptance Criteria

**Date**: 2026-02-24
**Purpose**: Define objective, testable criteria for "starter-ready transpiler support"
**Scope**: Must be met before any Phase 4.5B starter ships

---

## 1. Validation Coverage Behavior

### 1.1 Required Fields
- [ ] All `@db` fields with `:required` modifier generate `required` HTML attribute on corresponding form inputs
- [ ] Submit of form with empty required field is prevented by browser
- [ ] Missing required fields in API request return `400` with field names listed

### 1.2 Type Validation
- [ ] `input:email` generates `type="email"` with browser-native format validation
- [ ] `input:number` generates `type="number"` restricting non-numeric input
- [ ] `input:date` generates `type="date"` with date picker
- [ ] `<select>` elements constrain values to defined enum options

### 1.3 Server-Side Parity
- [ ] Every POST/PUT route validates request body fields against typed schema
- [ ] Type mismatches return `400` with specific error message
- [ ] Integer parameters validated in route paths

### 1.4 Measurable target
- **Required field coverage**: ≥90% of @db `:required` fields have `required` attribute on their form input
- **Type input coverage**: 100% of email/number/date @db fields use correct `<input type>`
- **Server validation coverage**: 100% of starter-critical generated form routes (auth login/register, entity create/update) have `validateFields()` call

---

## 2. Error Rendering Behavior

### 2.1 Auth Forms
- [ ] Failed login shows inline error message (not console-only)
- [ ] Failed registration shows inline error message
- [ ] Error message text is human-readable (e.g., "Invalid email or password", not "401")
- [ ] Error clears when user retypes

### 2.2 CRUD Forms
- [ ] Failed create shows visible error alert above form
- [ ] Failed update shows visible error alert
- [ ] Failed delete shows visible error alert
- [ ] Successful create shows success indicator (message or visual feedback)
- [ ] Successful update shows success indicator
- [ ] Error auto-clears on next successful operation

### 2.3 Data Loading
- [ ] Failed data fetch shows error alert (not blank page)
- [ ] Network timeout shows error (not infinite spinner)

### 2.4 Measurable target
- **Error visibility**: 0 instances of `console.error()` as the only error handling in user-facing flows
- **Success feedback**: ≥1 success indicator per CRUD create/update operation

---

## 3. Auth Flow Completeness

### 3.1 Login
- [ ] Email field (type="email")
- [ ] Password field (type="password")
- [ ] Sign In button (type="submit")
- [ ] Loading state while submitting (button disabled or spinner)
- [ ] Error message on failure
- [ ] Redirect to dashboard on success
- [ ] Token stored in localStorage/cookie

### 3.2 Registration (when present)
- [ ] Name, email, password fields minimum
- [ ] Submit button with loading state
- [ ] Error message on failure
- [ ] Redirect to login on success
- [ ] "Already have an account? Sign In" link

### 3.3 Forgot Password (when route defined)
- [ ] "Forgot Password?" link on login page
- [ ] Separate page with email input
- [ ] Email validation (required + format)
- [ ] Submit button with loading state
- [ ] Success message: "If an account exists..."
- [ ] Error state for server failures
- [ ] "Back to Login" link

### 3.4 Logout
- [ ] Clears auth token
- [ ] Clears user from localStorage
- [ ] Redirects to login page
- [ ] Accessible from all authenticated pages (sidebar or settings)

### 3.5 Measurable target
- **Auth completeness**: Login + Logout + Forgot Password link must be present on all starters with `@auth(required)`
- **Auth UX**: Every auth form has loading + error + success states

---

## 4. No Dead Primary CTAs

### 4.1 Definition
A "dead primary CTA" is a `btn:primary` or `btn:submit` in a core workflow that:
- Has no `onSubmit`/`onClick` handler, OR
- Has a handler that only does `console.log()`, OR
- Has a handler that calls an API function that doesn't exist

### 4.2 Criteria
- [ ] Every `btn:primary` in core pages has a wired handler
- [ ] Every form has an `onSubmit` that calls a real function
- [ ] Every navigation button (`btn:ghost` in nav) changes `currentPage`
- [ ] Non-primary buttons for excluded features are labeled "(Coming Soon)" or similar

### 4.3 Measurable target
- **Dead CTA count**: 0 in core workflows
- **Unwired mutation count**: 0 for mutations used in primary page flows
- **Verification**: Grep generated output for `console.log('.*attempted')` — should be 0 in starter output

---

## 5. Transpile Time Budget

| Metric | Target | How to measure |
|--------|--------|---------------|
| Parse time | <10ms | `result.stats.timing.extractMs` |
| Transpile time (total) | <200ms | `result.stats.timing.totalMs` |
| File count (starter) | 30–60 files | `result.files.length` |
| Output lines | 1500–3000 | `result.stats.outputLines` |

### 5.1 Measurable target
- **Parse + transpile**: <200ms for any starter `.air` file (up to 500 source lines)
- **Benchmark regression**: All existing bench.test.ts tests pass within 200ms ceiling
- **New benchmark**: At least 1 starter-sized fixture added to bench suite

---

## 6. Render/Startup Time Budget

| Metric | Target | How to measure |
|--------|--------|---------------|
| Vite dev server start | <5s | `air doctor` or manual timing |
| First meaningful paint | <3s | Browser DevTools Lighthouse |
| Page navigation | <100ms | Client-side, no network for SPA routing |

### 6.1 Measurable target
- **Dev server**: Starts without errors, serves pages
- **Page load**: No blank white screen — loading skeleton or content visible within 3s

---

## 7. Regression Safety

### 7.1 Existing Template Protection
- [ ] All 7 test-anchored example files produce identical output (snapshot test)
- [ ] All 20 base templates parse and transpile without errors
- [ ] 569 existing tests pass with 0 failures, 0 skipped (see Appendix A in transpiler-recommendation.md for baseline)
- [ ] No new TypeScript errors in `tsc --noEmit` (excluding known MCP server issues)

### 7.2 New Test Requirements per Phase
- Phase T1: ≥10 new tests covering gaps 01-04, 06, 08
- Phase T2: ≥6 new tests covering gaps 05, 07, 09, 12
- Phase T3: ≥4 new tests covering gaps 10, 11

### 7.3 Measurable target
- **Test count**: ≥579 after T1, ≥585 after T2
- **Snapshot stability**: Golden snapshot hashes unchanged for existing examples
- **Zero regression**: `npx vitest run` passes with 0 failures before and after each phase

---

## Verification Protocol

Before shipping any Phase 4.5B starter batch:

1. **Parse all starters**: `node -e "parse(fs.readFileSync(file))"` — 0 parse errors
2. **Transpile all starters**: `transpile(ast)` — 0 transpile errors
3. **Check for dead CTAs**: `grep -r "console.log.*attempted" generated_output/` — 0 matches
4. **Check for console-only errors**: `grep -r "console.error" generated_output/ | grep -v "catch"` — review each
5. **Run test suite**: `npx vitest run` — all pass
6. **Timing check**: `result.stats.timing.totalMs < 200` for each starter
7. **Required attribute check**: For each starter, count `required` attributes vs `:required` db fields — ratio ≥0.9
8. **Auth flow check**: Login page has email, password, submit, error display, forgot password link
