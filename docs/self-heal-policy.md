# AirEngine Self-Healing System — Policy

> Version 1.0 — A9 Foundation Phase (SH0–SH2)

## 1. Purpose

This policy governs how the AirEngine self-healing system captures, classifies, patches, verifies, and learns from failures across the transpiler pipeline, generated output, and runtime behavior.

## 2. Core Principles

1. **No auto-merge to main** — All patches require human approval before merge.
2. **No patch without tests** — Every accepted patch must include or reference a regression test.
3. **No patch without verification** — All patches must pass the full verification gate suite.
4. **Bounded patch scope** — Patches are constrained to declared subsystems/files/line counts.
5. **Mandatory promotion** — Every resolved incident must produce at least one regression test or invariant.
6. **Deterministic first** — Classifier and invariants use pattern matching, not LLM inference (SH0–SH2).

## 3. Incident Severity

| Level | Name | Definition | Response SLA |
|-------|------|------------|-------------|
| P0 | Critical | Generated app won't start, data loss risk, security flaw | Immediate |
| P1 | High | Feature broken, page crash, auth bypass, wrong data | Same session |
| P2 | Medium | Visual defect, UX friction, stale data display | Next session |
| P3 | Low | Cosmetic, docs drift, minor formatting | Backlog |

### Severity Assignment Rules

- Runtime crash or build failure → P0
- Auth/security route misconfiguration → P0
- `.map is not a function` or undefined state crash → P1
- Dead buttons / unwired handlers on key flows → P1
- Layout/CSS composition breaking page usability → P1
- Visual polish (spacing, alignment, contrast) → P2
- Seed data quality / formatting → P2
- Docs/config drift → P3
- Performance regression (no functional impact) → P3

## 4. Ownership Model

Each incident passes through six ownership stages:

| Stage | Owner | Responsibility |
|-------|-------|---------------|
| **Capture** | Automated (gate/sweep/golden) or human | Create incident artifact with evidence |
| **Triage** | Classifier (deterministic) | Classify, assign subsystem, set confidence |
| **Patch** | Patch bot (SH3, future) or human | Generate bounded patch proposal |
| **Verify** | Verifier orchestrator (SH4, future) | Run full gate suite against patch |
| **Promote** | System + human review | Add regression test / invariant / golden check |
| **Approve** | Human | Review and merge to branch (never auto-merge main) |

## 5. Incident Lifecycle

```
open → triaged → patching → verifying → resolved
                                      → failed (re-open)
open → wont_fix
open → duplicate
```

## 6. Classification Taxonomy

### 6.1 Visual / Layout / CSS

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `layout-auth-wrapper-composition` | jsx-gen, page-gen, scaffold | Nested auth wrapper breaks login width |
| `style-global-cta-width-regression` | scaffold | Global button rule forces all CTAs full-width |
| `style-responsive-overflow` | scaffold, page-gen | Cards/tables overflow on mobile |
| `style-contrast-unreadable` | scaffold | Text unreadable against background |
| `style-missing-icon` | page-gen, layout-gen | Icon component missing or broken |
| `style-card-form-malformed` | page-gen | Card/form layout structurally broken |

### 6.2 Frontend Runtime / Codegen

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `codegen-paginated-shape-mismatch` | page-gen, api-client-gen | `.map is not a function` on paginated response |
| `codegen-state-ordering-or-missing-binding` | page-gen | Undefined variable in generated component |
| `codegen-unwired-action-handler` | page-gen, mutation-gen | Button onClick calls undefined function |
| `codegen-duplicate-declaration` | page-gen | Same state variable declared twice |
| `codegen-route-navigation-bug` | jsx-gen | setCurrentPage targets wrong page |
| `codegen-loading-deadlock` | page-gen | Loading spinner never resolves |

### 6.3 Backend / API / Runtime

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `backend-route-guard-misclassification` | server-entry-gen, api-router-gen | Public route requires auth |
| `backend-route-registration-gap` | api-router-gen | Declared route not generated |
| `backend-query-param-handling` | api-router-gen | Filter/sort params ignored |
| `backend-aggregate-shape-mismatch` | api-router-gen | Stats endpoint returns wrong shape |
| `backend-status-transition-bug` | api-router-gen | Invalid state machine transition |
| `backend-middleware-wiring` | server-entry-gen | Middleware missing or misordered |

### 6.4 DB / Schema / Seed / Data

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `data-missing-field-or-index` | prisma-gen | slug field missing @unique |
| `data-seed-determinism-failure` | seed-gen | Different seed output per run |
| `data-seed-shape-mismatch` | seed-gen | Seed data doesn't match UI expectations |
| `data-null-handling` | page-gen, seed-gen | Optional field crashes on null |
| `data-format-assumption` | page-gen | Bad date/number formatting |

### 6.5 Transpiler / Compiler

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `transpiler-codegen-regression` | page-gen, jsx-gen, etc. | Previously working pattern broken |
| `transpiler-snapshot-drift` | any | Golden hash changed unexpectedly |
| `transpiler-path-regression` | page-gen | Wrong code path taken for page type |

### 6.6 Docs / Config / Operator

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `runtime-missing-provider-env` | operator-config | Missing env var crashes server |
| `docs-stale-command` | docs | Wrong script name in docs |
| `docs-stale-count` | docs | Test count outdated |
| `config-port-mismatch` | operator-config | Client/server port misalignment |

### 6.7 Performance / Regression

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `perf-transpile-slowdown` | transpiler | Transpile time exceeds budget |
| `perf-eval-latency` | eval | Golden/sweep takes too long |
| `perf-stability-regression` | any | Sweep case regresses |

### 6.8 Input

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `air-input-parse` | parser | .air file fails to parse |
| `air-input-validation` | validator | .air file fails validation |

### 6.9 Unknown

| Classification | Subsystem | Example |
|---------------|-----------|---------|
| `unknown` | unknown | No pattern matched |

## 7. Patch Scope Constraints

- **File limit**: Patches may modify at most 10 files.
- **Line limit**: Patches may change at most 200 lines (added + removed).
- **Subsystem limit**: Patches should stay within the suspected subsystem unless cross-cutting fix is justified.
- **No grammar changes**: Patches must not modify .air parser/lexer behavior.
- **No provider changes**: Patches must not modify Claude/LLM provider integration.

## 8. Verification Requirements

Every patch must pass:

1. `npx tsc --noEmit` — Type safety
2. `npx vitest run` — Full test suite
3. `npm run quality-gate -- --mode offline` — Quality gates
4. `npm run helpdesk-golden` — Helpdesk golden (32/32)
5. `npm run photography-golden` — Photography golden (30/30)
6. `npm run eval-complex` — Complex eval (6/6)

Plus incident-type-specific checks (re-transpile, re-seed, visual inspection).

## 9. Promotion Requirements

Every resolved incident must produce at least one of:

- New regression test case
- New invariant in `src/self-heal/invariants.ts`
- New golden capability check
- New stability sweep case
- Documentation of root cause for knowledge store

## 10. Phase Gate

| Phase | Scope | LLM Required | Auto-apply |
|-------|-------|-------------|------------|
| SH0 | Schemas + policy | No | N/A |
| SH1 | Capture + classify | No | N/A |
| SH2 | Invariants | No | N/A |
| SH3 | Patch bot | Yes (bounded) | No — human approval |
| SH4 | Verifier | No | Runs automatically |
| SH5 | Knowledge store | No | Append-only |
| SH6 | Regression promotion | No | Semi-auto, human review |
| SH7 | Model-assisted improvements | Yes | No — human approval |
