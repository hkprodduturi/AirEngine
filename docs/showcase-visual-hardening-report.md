# Showcase Visual Hardening Report

**Date**: 2026-02-25
**Branch**: feature/stability
**Scope**: Auth layout composition fix + polished theme variants for showcase apps

---

## Summary

Two-part visual hardening pass focused on (1) fixing the auth/login page layout composition bug that caused login forms to render inside constrained wrappers, and (2) adding curated theme variant presets for showcase demo apps. All fixes are at the transpiler/scaffold level — no `.air` grammar changes, no provider changes.

## Verification Gates (All Pass)

| # | Gate | Result |
|---|------|--------|
| 1 | `tsc --noEmit` | Clean |
| 2 | `vitest run` | 943 passed, 4 skipped (947 total) |
| 3 | `quality-gate --mode offline` | PASS (3/3) |
| 4 | `helpdesk-golden` | PASS (32/32 capabilities) |
| 5 | `eval-complex` | PASS (5/5, 100%) |
| 6 | `stability-sweep` | PASS (12/12) |
| 7 | `release-rehearsal` | GO |

---

## P0: Auth/Login Layout Composition Fix

### Root Cause

**Bug 1 — App.jsx wrapper constrains login page** (`jsx-gen.ts`)
When `hasAuthGating` is true but no Layout component, ALL pages (including login) rendered inside `max-w-[900px] mx-auto px-4 sm:px-6 py-8 space-y-6`. The login page's `min-h-screen flex items-center justify-center` fought with this constrained/padded parent.

**Bug 2 — Deep form wrapper adds redundant container** (`page-gen.ts`)
Complex apps define login as `main>grid:1(card(form(...)))`. This triggers `isDeepForm=true`, wrapping in `flex items-center justify-center min-h-screen` + `max-w-md`. But the AIR content already generates `<main flex-1 p-6>` → `<grid grid-cols-1 max-w-lg>` → `<card>`, creating triple padding and conflicting max-widths.

### Fixes Applied

| Fix | File | Detail |
|-----|------|--------|
| Auth page separation | `jsx-gen.ts` | Auth pages render directly in root div (full-screen); non-auth pages wrap inside constrained container behind `{isAuthed && (...)}` gate |
| Deep form `display:contents` | `page-gen.ts` | Auth deep form pages get `auth-form-wrapper` class |
| CSS structural flatten | `scaffold.ts` | `.auth-form-wrapper > main, .auth-form-wrapper > main > div[class*="grid-cols"]` → `display: contents` to collapse redundant structural elements |
| Auth button responsive width | `scaffold.ts` | Desktop: `width: auto; min-width: 160px`; Mobile (`<=640px`): `width: 100%` |

### Result

Login pages now render full-screen centered with no constrained wrapper, no double padding, and clean card-based form presentation.

---

## P1: Auth Page Visual Polish

| Change | File | Detail |
|--------|------|--------|
| Form group gap | `scaffold.ts` | `.form-group` gap increased to 8px |
| Input readability | `scaffold.ts` | Input `font-size: 0.9375rem` (15px) |
| Label contrast | `scaffold.ts` | `.form-group label` → `color-mix(in srgb, var(--fg) 70%, var(--muted))` |
| Input focus ring | `scaffold.ts` | Reduced to `0.12` opacity, subtle accent background `0.03` |
| Placeholder contrast | `scaffold.ts` | Opacity `0.85` for readability |
| Auth card spacing | `page-gen.ts` | Shallow form: `p-8 shadow-xl space-y-5`; deep form: `auth-form-wrapper` class |

---

## P1: Showcase Theme Variants

### Implementation

Added `THEME_VARIANTS` preset map in `scaffold.ts` with 3 named variants (+ 1 auto-resolved sub-variant). The `variant` key in `@style(...)` selects a curated CSS variable set. Variant values override defaults but NOT explicit `@style` overrides (accent/radius still honored).

### Variants

| Variant | Theme | Palette | Best For |
|---------|-------|---------|----------|
| `enterprise-clean` | Dark + Light | Dark: slate blues (#0f172a); Light: auto-resolves to `enterprise-clean-light` (#f8fafc) | Professional/corporate apps |
| `premium-dark` | Dark only | Near-black (#09090b), glass-morphism, deeper shadows | Premium/luxury apps |
| `modern-bright` | Light only | White + sky blue (#f0f9ff), soft shadows | Clean modern apps |

### Applied to Showcase Apps

| App | Variant | Accent | Notes |
|-----|---------|--------|-------|
| `helpdesk.air` | (default) | `#ef4444` (red) | Already polished; red accent works great |
| `projectflow.air` | `enterprise-clean` | `#2563eb` (blue) | Professional project management feel |
| `ecommerce.air` | `enterprise-clean` | `#f59e0b` (amber) | Clean commerce presentation |
| `dashboard.air` | `premium-dark` | `#a855f7` (purple) | Rich data dashboard aesthetic |
| `landing.air` | `modern-bright` | `#0ea5e9` (sky) | Bright marketing page feel |
| `fullstack-todo.air` | `enterprise-clean` | `#2563eb` (blue) | Clean utility app |

---

## Files Modified

| File | Changes |
|------|---------|
| `src/transpiler/react/jsx-gen.ts` | Auth page separation: auth pages outside wrapper, non-auth behind `{isAuthed}` gate |
| `src/transpiler/react/page-gen.ts` | Deep form `auth-form-wrapper` class for auth pages |
| `src/transpiler/scaffold.ts` | `THEME_VARIANTS` presets (3 variants + 1 auto-resolved light sub-variant), variant resolution logic, auth-form-wrapper CSS (`display:contents`), form polish (gap, font-size, label contrast), responsive button width |
| `examples/projectflow.air` | Added `variant:enterprise-clean` |
| `examples/ecommerce.air` | Added `variant:enterprise-clean` |
| `examples/dashboard.air` | Added `variant:premium-dark` |
| `examples/landing.air` | Added `variant:modern-bright` |
| `examples/fullstack-todo.air` | Added `variant:enterprise-clean` |
| `tests/transpiler.test.ts` | Updated auth button test: desktop `width: auto` + `min-width: 160px`, mobile `width: 100%` |
| `tests/__snapshots__/golden.json` | Refreshed hashes |

---

## Verification Details

### Regenerated Demo Checks

| App | Login Layout | Theme Vars | Button Width | Overall |
|-----|-------------|------------|--------------|---------|
| Helpdesk | auth-form-wrapper, outside Layout | Default dark | auto/160px (mobile: 100%) | PASS |
| ProjectFlow | auth-form-wrapper, outside Layout | enterprise-clean (#0f172a) | auto/160px (mobile: 100%) | PASS |
| Ecommerce | N/A (no auth) | enterprise-clean (#0f172a) | N/A | PASS |
| Dashboard | N/A (Layout-wrapped) | premium-dark (#09090b) | N/A | PASS |
| Landing | N/A (no auth) | modern-bright (#ffffff) | N/A | PASS |
| Auth | auth-form-wrapper, outside wrapper | Default dark | auto/160px (mobile: 100%) | PASS |
