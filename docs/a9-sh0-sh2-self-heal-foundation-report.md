# A9 — Self-Healing Foundation Report (SH0 + SH1 + SH2)

## Summary

Implemented the foundation layers of the AirEngine self-healing system: contracts/policy (SH0), incident capture + deterministic classification (SH1), and starter invariants (SH2). The system can now capture failures, classify them into 25+ known incident families, and catch 6 high-value bug patterns in generated output before runtime.

## Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `docs/self-heal-incident.schema.json` | Incident capture schema v1.0 | 130 |
| `docs/self-heal-patch-result.schema.json` | Patch proposal schema v1.0 (future SH3) | 80 |
| `docs/self-heal-verify.schema.json` | Verification report schema v1.0 (future SH4) | 75 |
| `docs/self-heal-knowledge.schema.json` | Knowledge store entry schema v1.0 (future SH5) | 65 |
| `docs/self-heal-policy.md` | Governance rules, severity, ownership model | 160 |
| `docs/self-heal-architecture.md` | Data flow, phase details, roadmap SH3–SH7 | 250 |
| `scripts/capture-incident.ts` | CLI tool for incident capture | 220 |
| `scripts/classify-incident.ts` | Deterministic pattern-matching classifier | 380 |
| `src/self-heal/invariants.ts` | 6 invariant definitions + runner | 310 |
| `tests/self-heal.test.ts` | SH0–SH2 schema + capture + classify + invariant tests | 670 |
| `tests/invariants.test.ts` | Focused invariant positive/negative tests | 160 |
| `docs/a9-sh0-sh2-self-heal-foundation-report.md` | This report | — |

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added `capture-incident` and `classify-incident` npm scripts |

## Schemas Created

### self-heal-incident.schema.json (v1.0)
- 12 source types (stability-sweep, goldens, evals, manual, runtime, etc.)
- 12 stage types (validate through qa-visual)
- 4 severity levels (P0–P3)
- Rich error detail (message, stack, raw_output, error_code, http_status)
- 7 input references (air_file, generated_file, page_name, route_path, etc.)
- 10 evidence types (console_line, stack_frame, screenshot_path, css_fragment, etc.)
- Embedded triage result with classification, subsystem, confidence, notes

### self-heal-patch-result.schema.json (v1.0)
- Patch scope constraints (subsystems, files, max_lines_changed)
- Diff entries (file path, type, content, line counts)
- Verification reference linkage
- Status lifecycle (proposed → approved → applied)

### self-heal-verify.schema.json (v1.0)
- Ordered verification steps with commands and exit codes
- Verdict (pass/fail/partial)
- Promotion record (regression test, invariant, golden, sweep)

### self-heal-knowledge.schema.json (v1.0)
- Resolved incident linkage
- Root cause + fix summary
- Recurrence tags + retrieval keywords
- Occurrence count tracking
- Related incidents

## Classifier Taxonomy

The pattern registry (`PATTERN_REGISTRY`) in classify-incident.ts contains 25 patterns across 9 categories:

### Visual / Layout / CSS (5 patterns)
- `layout-auth-wrapper-composition` → jsx-gen (high)
- `style-global-cta-width-regression` → scaffold (high)
- `style-responsive-overflow` → scaffold (medium)
- `style-contrast-unreadable` → scaffold (medium)
- `style-card-form-malformed` → page-gen (medium)

### Frontend Runtime / Codegen (6 patterns)
- `codegen-paginated-shape-mismatch` → page-gen (high)
- `codegen-state-ordering-or-missing-binding` → page-gen (high)
- `codegen-duplicate-declaration` → page-gen (high)
- `codegen-unwired-action-handler` → page-gen/mutation-gen (medium)
- `codegen-route-navigation-bug` → jsx-gen (medium)
- `codegen-loading-deadlock` → page-gen (medium)

### Backend / API / Runtime (5 patterns)
- `backend-route-guard-misclassification` → server-entry-gen (high)
- `backend-route-registration-gap` → api-router-gen (medium)
- `backend-query-param-handling` → api-router-gen (medium)
- `backend-aggregate-shape-mismatch` → api-router-gen (medium)
- `backend-middleware-wiring` → server-entry-gen (medium)

### DB / Schema / Seed / Data (4 patterns)
- `data-missing-field-or-index` → prisma-gen (medium)
- `data-seed-determinism-failure` → seed-gen (high)
- `data-seed-shape-mismatch` → seed-gen (medium)
- `data-null-handling` → page-gen (medium)

### Transpiler / Compiler (2 patterns)
- `transpiler-codegen-regression` → transpiler (medium)
- `transpiler-snapshot-drift` → transpiler (high)

### Docs / Config / Operator (3 patterns)
- `runtime-missing-provider-env` → operator-config (high)
- `config-port-mismatch` → operator-config (high)
- `docs-stale-command` → docs (medium)

### .air Input (2 patterns)
- `air-input-parse` → parser (high)
- `air-input-validation` → validator (high)

### Performance (2 patterns)
- `perf-transpile-slowdown` → transpiler (medium)
- `perf-stability-regression` → transpiler (medium)

### Fallback
- `unknown` → unknown (low)

## Invariants Implemented

| ID | Name | Severity | What It Catches |
|----|------|----------|----------------|
| INV-001 | Paginated list fetch unwrapping | P1 | `api.getX().then(r => setState(r))` without `.data ?? res` |
| INV-002 | Auth wrapper composition | P1 | LoginPage/SignupPage wrapped in `<Layout>` component |
| INV-003 | Global auth submit width | P2 | Unscoped `button { width: 100% }` CSS rules |
| INV-004 | Public route auth exemption | P0 | `/public/` paths not exempted from auth middleware |
| INV-005 | Public API auth-header | P1 | `getPublic*()` functions sending Authorization header |
| INV-006 | Slug route support | P1 | `:slug` routes not using `findFirst({ where: { slug } })` |

## Sample Incident → Triage

### Visual/Layout Incident
```
Capture: --source manual --summary "Login page auth wrapper width broken" --stage qa-visual
Triage:  layout-auth-wrapper-composition → jsx-gen (high confidence)
         "Auth page wrapped in conflicting layout shells..."
         Suggested invariant: auth-wrapper-composition
```

### Frontend Runtime Incident
```
Capture: --source photography-golden --summary "Dashboard crashes with .map is not a function"
Triage:  codegen-paginated-shape-mismatch → page-gen (high confidence)
         "Generated page assigns paginated response object directly to array state..."
         Suggested invariant: paginated-list-unwrapping
```

### Backend Incident
```
Capture: --source manual --summary "Public projects endpoint returns 401" --route-path /public/projects
Triage:  backend-route-guard-misclassification → server-entry-gen (high confidence)
         "Public route unexpectedly requires authentication..."
         Suggested invariant: public-route-auth-exemption
```

## Verification Results

### Core Safety
```
1) npx tsc --noEmit                          → clean (exit 0)
2) npx vitest run                            → 1023 passed, 4 skipped (1027 total)
3) npm run quality-gate -- --mode offline     → PASS (3/3 offline steps)
```

### SH0–SH2 Verification
```
4) capture-incident visual incident          → SH-20260226-061826-cyi04i created
5) classify-incident visual                  → layout-auth-wrapper-composition (high)
6) capture-incident + classify codegen       → codegen-paginated-shape-mismatch (high)
7) SH test counts                            → 70 passed (54 self-heal + 16 invariants)
8) Schema validation                         → all incidents validate against schema
9) Invariants on photography output          → 6/6 passed
```

### Regression Sanity
```
10) npm run helpdesk-golden                  → 32/32 PASS
11) npm run photography-golden               → 30/30 PASS
```

## Limitations

- **No patch bot**: SH3 patch generation is scaffolded in schemas/architecture but not implemented
- **No knowledge store runtime**: SH5 schema defined but no JSONL storage or retrieval yet
- **No auto-apply**: Patches require manual application and human approval
- **Pattern-based only**: Classifier uses string matching — no LLM-assisted triage yet
- **No runtime integration**: Gate scripts don't auto-pipe failures to capture-incident yet

## Next Steps

| Phase | Description | Dependency |
|-------|-------------|-----------|
| **SH3** | Patch bot orchestrator — Claude-assisted bounded patch proposals | SH1 complete |
| **SH4** | Verifier orchestrator — automated gate suite runner for patches | SH3 complete |
| **SH5** | Knowledge store — JSONL storage + retrieval for resolved incidents | SH3 complete |
| **SH6** | Regression promotion — auto-propose regression test/invariant additions | SH4 + SH5 complete |
| **SH7** | Model-assisted improvements — prompt tuning, retrieval tuning | 100+ incidents |
