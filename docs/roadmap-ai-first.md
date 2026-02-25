# AI-First Roadmap

## Strategic Context

This roadmap replaces the template/starter-focused Phase T1-T4 roadmap with an AI-first priority ordering. The goal is to optimize AirEngine for the autonomous agent loop (prompt → .air → validate → repair → transpile → run) rather than human template authoring.

All work is justified by its impact on the north star metric: **prompt-to-running-app success rate with zero human code edits**.

## Phase Overview

| Phase | Name | Focus | Duration | Key Outcome |
|-------|------|-------|----------|------------|
| **A1** | Diagnostics & Self-Repair | Structured validation for AI self-correction | 1-2 weeks | Agents can fix their own `.air` errors |
| **A2** | Transpiler Quality (T1 Completion) | Generated app quality improvements | 1-2 weeks | Generated apps work without manual fixes |
| **A3** | MCP Loop Hardening | Reliable end-to-end autonomous pipeline | 1 week | Full loop runs without human intervention |
| **A4** | Benchmark Harness | Quantitative proof of differentiation | 1 week | Data showing 10x token efficiency + >85% success |
| **A5** | Canonical Demo | Homepage-ready showcase | 3-5 days | 60-second video: prompt → running app |
| **A6** | Eval Suite & Regression | Ongoing quality assurance | 1 week | CI-integrated regression preventing backslides |

---

## Phase A1: Diagnostics & Self-Repair

**Justification**: The #1 bottleneck for AI success rate is repair quality. Currently, parse errors return unstructured messages that AI agents struggle to act on. Structured diagnostics with fix hints directly improve first-pass and repair success rates.

### Deliverables

| # | Item | Description |
|---|------|-------------|
| A1.1 | `Diagnostic` type | Define `Diagnostic` interface in `src/types.ts` per validation-diagnostics-spec.md |
| A1.2 | Error code registry | Assign stable codes (AIR-P*, AIR-E*, AIR-W*, AIR-L*) to all existing errors |
| A1.3 | Parser error wrapping | Catch `AirParseError`/`AirLexError` and transform to `Diagnostic` format with `fix` hints |
| A1.4 | Validator upgrade | Expand from 3 rules to 9+ rules (see diagnostics spec AIR-E001 through AIR-E009) |
| A1.5 | Lint → Diagnostic | Convert lint hints from `{ level, message }` to full `Diagnostic` with `fix` fields |
| A1.6 | MCP `air_validate` v2 | Return `DiagnosticResult` envelope with backward-compat `format` parameter |
| A1.7 | New validation rules | Page-route consistency (AIR-E005), duplicate pages (AIR-E004), auth completeness (AIR-E008) |

### Acceptance Criteria

- [ ] All parse errors return `Diagnostic` with `code`, `location`, and `fix.description`
- [ ] All validation errors have fix hints (at minimum `fix.description`)
- [ ] `air_validate` MCP tool returns `DiagnosticResult` when `format: "v2"` requested
- [ ] 6+ new validation rules implemented (AIR-E004 through AIR-E009)
- [ ] All existing tests pass (569+ tests)
- [ ] 15+ new tests covering diagnostic format and fix hints

### Measurable Outcome

Before A1: AI repair success rate ~unknown (no structured feedback)
After A1: AI can parse every diagnostic, apply fix hints, and re-validate

---

## Phase A2: Transpiler Quality (T1 Completion)

**Justification**: Generated apps need to work without manual code edits. The T1 transpiler improvements directly improve generated app quality. This phase completes the partially-implemented T1 work and validates it.

### Deliverables

| # | Item | Status | Description |
|---|------|--------|-------------|
| A2.1 | T1.1: CRUD pages render .air UI | Code done, tests partial | Fix remaining test fixtures, validate |
| A2.2 | T1.2: Error surfacing | Code done, tests partial | Fix test fixtures, validate error/success state |
| A2.3 | T1.3: HTML5 validation | Code done, tests partial | Fix test fixtures, validate required attributes |
| A2.4 | T1.4: Forgot password | Code done, tests partial | Fix test fixtures, validate auth flow |
| A2.5 | T1.5: Mutation wiring | Code done, tests partial | Fix test fixtures, validate verb+model matching |
| A2.6 | T1.6: Cancel button | Code done, tests partial | Fix test fixtures, validate form reset |
| A2.7 | CRUD expansion bug | Known bug | Fix `expandCrud` handler extraction (`~db.Item` → `~db` instead of `~db.Item`) |
| A2.8 | T1 test completion | 12 failing | Fix all T1 inline fixture syntax, achieve 0 failures |
| A2.9 | Golden snapshot update | Needed | Update snapshots after all T1 changes stabilized |
| A2.10 | T1 validation report | Needed | `docs/t1-validation-report.md` with before/after evidence |

### Acceptance Criteria

- [ ] All 569+ existing tests pass
- [ ] 20+ new T1 tests pass (currently 12 failing due to fixture syntax)
- [ ] CRUD expansion bug fixed (handlers correctly include model name)
- [ ] Golden snapshots updated and stable
- [ ] Generated CRUD pages have error/success state
- [ ] Generated forms have HTML5 validation attributes
- [ ] Forgot password flow generates server + client code
- [ ] Verb+model mutation matching works (e.g., `resolveTicket` → PUT /tickets/:id)

### Measurable Outcome

Before A2: Generated apps have dead buttons, no error feedback, no form validation
After A2: Generated apps have working forms, error states, auth flows, and mutation wiring

---

## Phase A3: MCP Loop Hardening

**Justification**: The MCP server is the primary interface for AI agents. It must be robust, fast, and provide the right abstractions for the autonomous generate → validate → repair → transpile loop.

### Deliverables

| # | Item | Description |
|---|------|-------------|
| A3.1 | `air_generate` implementation | Replace stub with structured prompt that includes spec + examples + constraints |
| A3.2 | Loop orchestration tool | New `air_loop` MCP tool that runs validate → repair → transpile in one call |
| A3.3 | Structured repair response | When validation fails, return diagnostics + suggested patches in agent-consumable format |
| A3.4 | Session artifacts logging | Log each loop run: source versions, diagnostics, repairs, final result, timing |
| A3.5 | Smoke test integration | Add optional `smoke_test: true` parameter to `air_transpile` that runs L0+L1 checks |
| A3.6 | Error recovery protocol | Define retry semantics: max attempts, escalation, failure artifacts |
| A3.7 | Spec resource update | Update `air://spec` to include diagnostic codes and fix hint patterns |

### Acceptance Criteria

- [ ] `air_generate` returns a structured prompt that agents can use to generate valid `.air`
- [ ] `air_loop` tool runs full pipeline and returns structured result
- [ ] Diagnostics include fix hints that agents can apply programmatically
- [ ] Session artifacts logged as JSON per run
- [ ] MCP server handles 100+ sequential tool calls without memory leaks
- [ ] All existing MCP tests pass (30+ tests)
- [ ] 10+ new MCP loop tests

### Measurable Outcome

Before A3: Agent must manually orchestrate validate → repair → transpile calls
After A3: Single `air_loop` call handles the full pipeline with built-in retry

---

## Phase A4: Benchmark Harness

**Justification**: Quantitative proof is required to demonstrate AirEngine's value proposition (token efficiency, speed, reliability) vs raw AI code generation.

### Deliverables

| # | Item | Description |
|---|------|-------------|
| A4.1 | Offline harness | Transpile time + compression ratio + smoke test pass rate for baseline `.air` files |
| A4.2 | 10 baseline `.air` files | Hand-verified valid `.air` covering T1-T4 complexity tiers |
| A4.3 | Online harness | Claude API integration for token cost + time + success rate comparison |
| A4.4 | Raw path comparison | Equivalent prompts generating React/Express/Prisma directly |
| A4.5 | Report generator | Markdown summary table from benchmark results JSON |
| A4.6 | CI offline benchmarks | Run transpile time + smoke tests on every PR |

### Acceptance Criteria

- [ ] Offline benchmarks run in < 30 seconds
- [ ] 10 baseline `.air` files all transpile and build successfully
- [ ] Token ratio measured for at least 5 prompts (target: > 10x)
- [ ] Success rate measured for at least 5 prompts × 5 runs each
- [ ] Report generated automatically from results JSON
- [ ] CI runs offline benchmarks, fails on regression > 10%

### Measurable Outcome

Concrete data: "AirEngine generates apps with 12x fewer tokens, 2x faster, with 87% success rate vs 62% for raw generation"

---

## Phase A5: Canonical Demo

**Justification**: A compelling 60-second demo proves the product works and drives adoption. The demo must be reproducible and showcase the full AI-first loop.

### Deliverables

| # | Item | Description |
|---|------|-------------|
| A5.1 | Demo prompt | Single natural language prompt that produces a compelling app |
| A5.2 | Demo `.air` | The AI-generated `.air` (pre-recorded but reproducible) |
| A5.3 | Demo script | Step-by-step script: prompt → .air → validate → transpile → run |
| A5.4 | Timing captures | Wall-clock time for each step |
| A5.5 | Screenshots | Before (prompt) and after (running app) |
| A5.6 | Demo spec doc | `docs/demo-spec-canonical.md` with all details |

### Acceptance Criteria

- [ ] Demo app has auth (login/register), database (2+ models), API, styled UI
- [ ] Total time from prompt to running app < 60 seconds
- [ ] Zero human code edits required
- [ ] Demo is reproducible (same .air → same output)
- [ ] App visually polished (dark theme, responsive layout)

### Measurable Outcome

A shareable 60-second recording showing prompt-to-running-app with timing overlay

---

## Phase A6: Eval Suite & Regression

**Justification**: Continuous quality assurance prevents backslides. The eval suite uses existing template corpus as regression inputs.

### Deliverables

| # | Item | Description |
|---|------|-------------|
| A6.1 | Eval corpus formalization | 10 canonical `.air` files in `tests/eval/` directory |
| A6.2 | Transpile regression tests | All eval corpus files must transpile deterministically |
| A6.3 | Build regression tests | All eval corpus outputs must pass `npm run build` |
| A6.4 | Diagnostic regression tests | Known-bad `.air` files with expected diagnostic output |
| A6.5 | Performance regression | Transpile time ceiling enforcement (existing bench.test.ts extended) |
| A6.6 | Coverage tracking | Track which AIR language features are exercised by eval corpus |

### Acceptance Criteria

- [ ] 10 eval corpus `.air` files committed and passing
- [ ] All produce deterministic output (hash-verified)
- [ ] All build successfully
- [ ] 5+ known-bad `.air` files with expected diagnostic output
- [ ] Performance benchmarks in CI with alerting on regression
- [ ] Coverage report showing which blocks/elements/operators are tested

### Measurable Outcome

Before A6: Regressions discovered manually
After A6: CI catches regressions automatically, eval corpus proves breadth

---

## Dependency Graph

```
A1 (Diagnostics)
  ↓
A2 (Transpiler Quality) ← can start in parallel with A1
  ↓
A3 (MCP Loop) ← depends on A1 diagnostics format
  ↓
A4 (Benchmarks) ← depends on A2 transpiler quality + A3 loop
  ↓
A5 (Demo) ← depends on A3 loop working + A2 quality
  ↓
A6 (Eval Suite) ← depends on A4 baselines
```

### Parallelization Opportunities

- A1 and A2 can run in parallel (diagnostics vs transpiler code are independent)
- A5 and A6 can overlap (demo creation while building eval suite)
- A4 offline benchmarks can start as soon as A2 is complete

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| CRUD expansion bug causes widespread test failures | High | Medium | Fix in A2.7 early, before test completion |
| AI agents struggle to apply fix hints despite structured format | High | Low | Test with multiple LLMs (Claude, GPT-4) in A4 |
| Transpile time regresses beyond 200ms budget | Medium | Low | Existing bench.test.ts catches this |
| Online benchmarks require expensive API calls | Low | High | Focus on offline benchmarks first (A4.1-A4.2) |
| MCP session cache causes stale results | Medium | Medium | Add cache-bust parameter in A3 |

## What This Roadmap Does NOT Include

- Style variants (deprioritized per product direction)
- Template gallery UI (deprioritized)
- Human-facing starter marketing (deprioritized)
- `.air` syntax sugar for human writeability (not AI-first)
- Visual editor or GUI builder (out of scope)
- Phase T2-T4 from previous roadmap (subsumed by A2 for critical items only)
