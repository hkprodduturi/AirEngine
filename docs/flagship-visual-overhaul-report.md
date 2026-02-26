# Flagship Visual Overhaul Report

## Summary

This report documents the visual hardening pass for AirEngine's flagship showcase apps.
Three categories of changes were made:

1. **P0: Auth/Login Layout Composition Fix** — structural bugs causing broken auth pages
2. **P1: Visual System Refresh** — CSS token improvements for premium quality
3. **P1: Theme Variant Presets** — 3 curated visual variants for showcase diversity

All C0–C5 functionality preserved. All gates green.

---

## P0: Root Causes Fixed

### Bug 1 — Auth pages constrained by App.jsx wrapper

**File:** `src/transpiler/react/jsx-gen.ts` (`generateRootJSX()`)

**Root cause:** When `hasAuthGating` is true but no Layout component exists, ALL pages
(including login/register) rendered inside a `max-w-[900px] mx-auto px-4 py-8` wrapper.
Login pages use `min-h-screen flex items-center justify-center` for centering, which
conflicts with the constrained/padded parent.

**Fix:** When `hasAuthGating && !hasLayout`, extract scoped pages and split them into two
groups using `isAuthPageName()`:
- **Auth pages** (login/register) — rendered directly in root div, no wrapper constraints
- **Non-auth pages** — wrapped in `{isAuthed && (<div className="...wrapper...">...</div>)}`

This matches the Layout-enabled path (line 44) which already handled this correctly.

### Bug 2 — Deep form redundant background/padding

**File:** `src/transpiler/react/page-gen.ts` (`generateOriginalPage()`)

**Root cause:** Auth pages with `main>grid:1(card(form(...)))` structure trigger `isDeepForm=true`,
which wraps in `<div className="... min-h-screen p-4 bg-[var(--bg)]">`. But the App.jsx root
div already has `min-h-screen bg-[var(--bg)]`, creating:
- Double `bg-[var(--bg)]` (redundant)
- Extra `p-4` padding fighting with inner `p-8` card padding

**Fix:** Removed `p-4 bg-[var(--bg)]` from both shallow-form and deep-form page wrappers.
The root div already handles background. Changed `shadow-lg` to `shadow-xl` and `space-y-6`
to `space-y-5` for tighter auth card rhythm.

---

## P1: Visual System Changes

### CSS Base Improvements (`src/transpiler/scaffold.ts`)

| Area | Before | After |
|------|--------|-------|
| Form group gap | 6px | 8px |
| Input font-size | 0.875rem (14px) | 0.9375rem (15px) |
| Label color | `var(--muted)` | `color-mix(in srgb, var(--fg) 70%, var(--muted))` |
| Submit buttons | inline width | `width: 100%` via CSS rule |
| Typography | no `color` on headings | explicit `color: var(--fg)` |
| Paragraph | no `line-height` | `line-height: 1.65` |
| Table font | inherited | `font-size: 0.875rem` |
| Table headers | `font-size: 0.75rem` | `font-size: 0.6875rem`, `white-space: nowrap` |
| Table cells | basic padding | `vertical-align: middle` |
| Button hover | `opacity: 0.9` only | `opacity: 0.92` + `box-shadow: 0 2px 8px rgba(0,0,0,0.1)` |
| Button active | `scale(0.98)` | `scale(0.97)`, `box-shadow: none` |
| Button transition | `0.2s` | `0.15s` (snappier) |
| Card default | no shadow | `box-shadow: var(--card-shadow)` |
| Card hover shadow | `0 8px 32px accent` | `0 8px 24px accent + 0 2px 8px black` |
| Modal backdrop | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.6)` + `backdrop-filter: blur(4px)` |
| Modal panel | `padding: 24px`, basic shadow | `padding: 28px`, deeper shadow + accent glow |
| Sidebar | no shadow | `shadow-[1px_0_8px_rgba(0,0,0,0.08)]` |

### Theme Variant Presets

3 curated presets added to `THEME_VARIANTS` map in `scaffold.ts`:

#### `enterprise-clean`
- Professional/corporate look with slate blue surfaces
- Dark: `--bg:#0f172a`, `--bg-secondary:#1e293b`, subtle borders
- Light: `--bg:#f8fafc`, `--bg-secondary:#ffffff`, clean borders
- Tight gradient: `ellipse 80% 50% at 50% -20%`, 8% opacity
- Best for: business apps, project management, admin panels

#### `premium-dark`
- Rich dark premium feel with deep surfaces
- `--bg:#09090b`, `--bg-secondary:rgba(255,255,255,0.04)`
- Very subtle borders: `rgba(255,255,255,0.06)`
- Dramatic gradient: `ellipse 60% 40% at 50% -10%`, 18% opacity
- Best for: dashboards, analytics, developer tools

#### `modern-bright`
- Clean light modern with sky-blue tints
- `--bg:#ffffff`, `--bg-secondary:#f0f9ff`
- Sky-tinted borders: `#e0f2fe`
- Subtle gradient, soft shadows
- Best for: marketing sites, consumer apps, landing pages

### Variant Application

Variants override default theme variables but NOT explicit `@style` overrides
(accent/radius/font still honored). Applied via `variant` key in `@style(...)`.

---

## Flagship Apps

### 1. Helpdesk (`examples/helpdesk.air`)
- **Variant:** None (default dark + accent:#ef4444 already polished)
- **Auth fix:** Login page now renders outside wrapper — full-screen centered
- **Status:** 32/32 golden capabilities, 35 files, 2411 lines

### 2. ProjectFlow (`examples/projectflow.air`)
- **Variant:** `enterprise-clean` + accent:#2563eb + radius:6
- **Changes:** Professional slate-blue surfaces, tighter radius, clean borders
- **Status:** Transpiles cleanly, all gates pass

### 3. E-Commerce (`examples/ecommerce.air`)
- **Variant:** `enterprise-clean` + accent:#f59e0b + radius:8
- **Changes:** Professional surfaces with warm amber accent
- **Status:** Transpiles cleanly, all gates pass

### Additional Updated Apps

| App | Variant | Accent | Radius |
|-----|---------|--------|--------|
| `dashboard.air` | `premium-dark` | #a855f7 (purple) | 12 |
| `landing.air` | `modern-bright` | #0ea5e9 (sky) | 10 |
| `fullstack-todo.air` | `enterprise-clean` | #2563eb (blue) | 6 |

---

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `src/transpiler/react/jsx-gen.ts` | Modified | P0: Auth pages outside wrapper |
| `src/transpiler/react/page-gen.ts` | Modified | P0: Remove redundant bg/padding |
| `src/transpiler/react/layout-gen.ts` | Modified | P1: Sidebar shadow depth |
| `src/transpiler/scaffold.ts` | Modified | P1: CSS polish + theme variants |
| `examples/projectflow.air` | Modified | enterprise-clean variant |
| `examples/dashboard.air` | Modified | premium-dark variant |
| `examples/landing.air` | Modified | modern-bright variant |
| `examples/fullstack-todo.air` | Modified | enterprise-clean variant |
| `examples/ecommerce.air` | Modified | enterprise-clean variant |
| `tests/transpiler.test.ts` | Modified | Updated landing.air test assertions |
| `tests/__snapshots__/golden.json` | Modified | Refreshed hashes |
| `docs/flagship-visual-overhaul-report.md` | Created | This report |

---

## Verification Results

### Core Safety

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npx vitest run` | 938 passed, 4 skipped (942 total) |
| `npm run quality-gate -- --mode offline` | PASS (3/3 offline) |

### Complex Readiness

| Command | Result |
|---------|--------|
| `npm run complex-readiness` | PASS (3+32+32 = 67/67) |
| `npm run helpdesk-golden` | PASS (32/32 capabilities) |
| `npm run eval-complex` | PASS (5/5 replay, 100% success) |

### Showcase & Release

| Command | Result |
|---------|--------|
| `npm run stability-sweep` | PASS (12/12: 7 showcase + 5 replay) |
| `npm run release-rehearsal -- --mode offline` | PASS / GO |

---

## Remaining Visual Backlog (P2/P3)

These are polish items that do not affect demo-readiness:

- **P2:** Badge color variants (success/warning/error) — currently accent-only
- **P2:** Loading skeleton shimmer animation (currently basic pulse)
- **P2:** Toast/snackbar for async operation feedback
- **P3:** Sticky table headers for scrollable tables
- **P3:** Keyboard navigation for modals (ESC to close, Tab trap)
- **P3:** Focus ring consistency on all interactive elements
- **P3:** Custom scrollbar styling inside sidebar overflow
