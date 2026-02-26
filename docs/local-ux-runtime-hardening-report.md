# Local UX & Runtime Hardening Report

## Overview

Systematic visual hardening pass across all flagship surfaces (Helpdesk, ProjectFlow, fullstack-todo, dashboard, landing). Focused on fixing broken CSS, runtime crashes, dead UI elements, and visual quality issues in the transpiler output.

## Fixes Applied

### P0 — Critical (Broken/Crash)

| Issue | File | Fix |
|-------|------|-----|
| Invalid CSS `space-y: 1.25rem` | scaffold.ts | Replaced with `> * + * { margin-top: 1.25rem; }` (valid CSS) |
| `priorityFilter` ReferenceError crash | page-gen.ts | Declare filter state vars early (before load/useEffect use them) |
| "New Ticket" button dead (no onClick) | page-gen.ts | Post-process CRUD pages to wire "New {Model}" buttons to `setShowForm(!showForm)` |

### P1 — Visual Quality

| Issue | File | Fix |
|-------|------|-----|
| Button hover lift on ALL buttons (nav, ghost, tabs) | scaffold.ts | Removed `translateY(-1px)` from base `button:hover`; scoped lift to accent/red buttons only |
| Card hover has jarring translateY(-2px) lift | scaffold.ts | Removed transform; kept subtle accent border tint + soft shadow |
| Tickets/Agents sidebar icons show hamburger fallback | layout-gen.ts | Added 14 new nav icons (tickets, agents, support, departments, files, documents, help, knowledge, articles, categories, tags, expenses, todos) |
| Auth form card spacing too tight | scaffold.ts | Auth wrapper: `padding: 2rem 2.25rem`, `> * + * { margin-top: 1.25rem }`, improved heading/form/button sizes |
| Input focus ring too strong | scaffold.ts | Reduced from 0.15 to 0.12 opacity, added subtle accent background on focus |
| Section `py-16` too much inside Layout | element-map.ts | Changed section from `py-16` to `py-8` for proportional spacing inside sidebar layouts |
| Card hover uses transition-all (triggers all properties) | element-map.ts | Changed to `transition-colors duration-200` (more targeted, less jarring) |

## Files Modified

| File | Changes |
|------|---------|
| `src/transpiler/scaffold.ts` | Auth CSS fix, button hover scoping, card hover refinement, input focus, auth form wrapper polish |
| `src/transpiler/react/page-gen.ts` | Filter state early declaration, "New {Model}" button wiring |
| `src/transpiler/react/layout-gen.ts` | 14 new nav icon SVG paths |
| `src/transpiler/element-map.ts` | Card hover, section padding |
| `tests/__snapshots__/golden.json` | Refreshed (CSS, layout, page hashes) |

## Gate Results

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | Clean |
| `npx vitest run` | 937 passed, 4 skipped (941 total) |
| `npm run quality-gate -- --mode offline` | PASS (3/3) |
| `npm run helpdesk-golden` | 32/32 PASS |
| `npm run eval-complex` | 5/5 PASS (100%) |

## Generated Output Summary

| App | Files | Lines | Status |
|-----|-------|-------|--------|
| helpdesk | 35 | 2453 | Clean, all surfaces functional |
| projectflow | 45 | 3536 | Clean, button wiring fixed |
| fullstack-todo | 25 | 1188 | Clean |
| dashboard | 26 | 1394 | Clean |
| landing | 9 | 479 | Clean |

## Visual Audit Scores (Post-Fix)

| Surface | Score | Notes |
|---------|-------|-------|
| Helpdesk Login | 8/10 | Centered card, proper spacing, full-width submit, accent focus ring |
| Helpdesk Dashboard | 8/10 | Stat cards, loading skeleton, recent tickets, sidebar with correct icons |
| Helpdesk Tickets | 8/10 | Filters, search, "New Ticket" wired, CRUD form, pagination |
| Helpdesk Agents | 8/10 | Agent cards with stats, pagination, loading states |
| Helpdesk Sidebar | 9/10 | Proper icons, active states, user section, responsive mobile drawer |
| ProjectFlow | 8/10 | All pages render, buttons wired, enterprise-clean variant |
