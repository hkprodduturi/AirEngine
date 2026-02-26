# Local UX & Runtime Hardening Report

**Date**: 2026-02-25
**Branch**: feature/stability
**Scope**: Visual QA + runtime hardening for flagship demo apps (2 rounds)

---

## Summary

Systematic visual quality audit and generator-level fixes across 3 flagship apps (helpdesk, projectflow, ecommerce) and 3 secondary apps (fullstack-todo, dashboard, landing). All fixes are at the transpiler level — no `.air` grammar changes, no provider changes.

## Verification Gates (All Pass)

| # | Gate | Result |
|---|------|--------|
| 1 | `air doctor` | PASS |
| 2 | `tsc --noEmit` | Clean |
| 3 | `vitest run` | 942 passed, 4 skipped |
| 4 | `quality-gate --mode offline` | PASS (3/3) |
| 5 | `complex-readiness` | PASS (32/32 capabilities) |
| 6 | `helpdesk-golden` | PASS (32/32) |
| 7 | `eval-complex` | PASS (5/5, 100%) |
| 8 | `stability-sweep` | PASS (12/12) |
| 9 | `release-rehearsal` | GO |

---

## Round 1 Fixes — Visual Layout

### P0 — Critical (Broken/Crash)

| Issue | File | Fix |
|-------|------|-----|
| Invalid CSS `space-y: 1.25rem` | scaffold.ts | Replaced with `> * + * { margin-top: 1.25rem; }` |
| `priorityFilter` ReferenceError crash | page-gen.ts | Declare filter state vars early |
| "New Ticket" button dead | page-gen.ts | Wire "New {Model}" buttons to `setShowForm(!showForm)` |

### P1 — Visual Quality

| Issue | File | Fix |
|-------|------|-----|
| Flat list items (all fields inline) | jsx-gen.ts | Changed `iterItemClass` to `.list-row` CSS class |
| Double-sticky header | element-map.ts | Removed `sticky top-0 z-40`, changed to `bg-[var(--surface)]` |
| Badges all same color | page-gen.ts | Added `_bc()` semantic badge color helper + `applyBadgeColors()` post-processor |
| Stat cards visually identical | element-map.ts + scaffold.ts | Added `stat-card` class with nth-child colored left borders |
| Button hover lift on ALL buttons | scaffold.ts | Scoped translateY to accent/red buttons only |
| Card hover jarring | element-map.ts | Changed to `transition-colors duration-200` |
| Sidebar icons fallback | layout-gen.ts | Added 14 new nav icons |
| Auth form card spacing | scaffold.ts | Auth wrapper padding, heading/button sizes |
| Input focus ring too strong | scaffold.ts | Reduced opacity, added subtle accent background |
| Placeholder low contrast | scaffold.ts | Changed opacity from 0.7 to 0.85 |

---

## Round 2 Fixes — Mutation Wiring

Root cause: `mutation-gen.ts` had missing `else` fallbacks for `add`/`toggle`, and `page-gen.ts` skipped standard mutation names (del, add, toggle) in CRUD pages assuming CRUD handlers covered them, but CRUD generates `handleCreate`/`handleDelete` while JSX references `del()`/`add()`.

### P0 — Undefined Function References

| Issue | File | Fix |
|-------|------|-----|
| `add`/`addItem` stub missing | mutation-gen.ts | Added `else` fallback (console.log stub) |
| `toggle` stub missing | mutation-gen.ts | Added `else` fallback |
| `del()` undefined in CRUD pages | page-gen.ts | Safety net: `del` → `setDeleteId(id)` (modal pattern) |
| `done()` undefined | page-gen.ts | Safety net: `done` → `api.{putFnName}(id, { status: 'done' })` |
| `archive()` wrong API | page-gen.ts | Safety net: `archive` → `api.{putFnName}(id, { status: 'archived' })` |
| `checkout()` undefined | page-gen.ts | Safety net: `checkout` → `api.{postFnName}({ items })` |
| `toggle()` undefined in CRUD | page-gen.ts | Safety net: `toggle` → field toggle via PUT |
| Unmatched mutations crash | page-gen.ts | Safety net: fallback → console.log stub |

### P1 — Runtime Issues

| Issue | File | Fix |
|-------|------|-----|
| Loading skeleton stuck forever (no GET route) | page-gen.ts | Added `useEffect(() => { setLoading(false); }, []);` when no getFnName |
| `cartTotal` undefined (NaN render) | page-gen.ts | Added `(varName).method()` detection pattern + numeric default for Total/Count/Amount vars |

---

## Round 3 Fixes — Demo Flow & Polish

### P1 — Detail Page Navigation

| Issue | File | Fix |
|-------|------|-----|
| Detail page unreachable | jsx-gen.ts | Pass `setSelected{Model}Id` prop from App.jsx to list pages |
| List rows not clickable | page-gen.ts | Post-process list-row divs to add `onClick={() => setSelected{Model}Id(item.id)}` + cursor |
| CRUD page missing setter prop | page-gen.ts | Added `detailModel` detection, added setter to function signature |

### P1 — Action Params

| Issue | File | Fix |
|-------|------|-----|
| Assign button missing agent_id | page-gen.ts | Default to `user?.id` when agent_id not provided |
| Archive calls wrong API route | page-gen.ts | Skip generic route match for archive/done; use page-binding `putFnName` |

### P1 — Ecommerce Cart

| Issue | File | Fix |
|-------|------|-----|
| `add` maps to form toggle | page-gen.ts | Detect cart array + argNodes → local state push with dedup |
| Cart not persisted across pages | page-gen.ts | localStorage persistence on add/del/checkout |
| CartPage always empty | page-gen.ts | Load from localStorage on mount for cart-like arrays |
| `del` is stub on CartPage | page-gen.ts | Cart-aware del: remove from array + persist |
| `checkout` is stub | page-gen.ts | Cart-aware checkout: clear array + success message |
| `cartTotal` always 0 | page-gen.ts | Auto-computed via `useEffect` from cart items (price * quantity) |

---

## Files Modified

| File | Changes |
|------|---------|
| `src/transpiler/react/jsx-gen.ts` | list-row class, detail page setter prop wiring |
| `src/transpiler/react/page-gen.ts` | Badge colors, mutation safety net (v2: cart-aware), loading fix, variable detection, detail page navigation, assign params, cartTotal computation |
| `src/transpiler/react/mutation-gen.ts` | add/toggle fallbacks |
| `src/transpiler/element-map.ts` | Header sticky removal, stat-card class, section padding, card hover |
| `src/transpiler/scaffold.ts` | stat-card CSS, list-row CSS, placeholder contrast, auth CSS, button hover, input focus |
| `src/transpiler/react/layout-gen.ts` | 14 new nav icon SVG paths |
| `tests/__snapshots__/golden.json` | Refreshed hashes |

## Quality Scores

### Flagship Apps (Before → Round 2 → Round 3)

| App | Before | R2 | R3 | Key R3 Improvements |
|-----|--------|----|----|---------------------|
| **Helpdesk** | 7.2 | 8.2 | **8.5** | Detail page reachable via list row click, assign works |
| **ProjectFlow** | 5.8 | 7.8 | **8.2** | archive→updateProject, done→updateTask, del→modal, detail nav |
| **Ecommerce** | 5.5 | 7.2 | **8.0** | Cart add/del/checkout functional, localStorage persistence, cartTotal computed |

### Helpdesk Surface-Level Scores

| Surface | Score | Notes |
|---------|-------|-------|
| Login | 8/10 | Clean centered modal, proper form |
| Layout/Sidebar | 9/10 | Excellent responsive design, no double-sticky |
| Dashboard | 8/10 | Stat cards with color accents, list-row for recent items |
| Tickets | 9/10 | Clickable rows → detail page, filter tabs, badge colors, pagination |
| Agents | 8/10 | Card grid, badge colors |
| Detail | 8.5/10 | Reachable via ticket click, back button, replies |
| CSS | 9/10 | Comprehensive design system |

### Remaining P2/P3 Issues

| # | Pri | App | Issue |
|---|-----|-----|-------|
| 1 | P2 | ProjectFlow | SettingsPage updateProfile/updateWorkspace are console.log stubs (no settings API routes) |
| 2 | P2 | ProjectFlow | DashboardPage activity feed never populated (no comments API wiring) |
| 3 | P3 | All | `_bc()` helper duplicated across pages (could be shared module) |
| 4 | P3 | All | Nav icons are generic SVG paths for some sections |
