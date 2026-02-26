# C5 — Flagship Demo + Complex Eval + Regression Guard Report

## Summary

C5 proves complex-app readiness end-to-end with three deliverables:

1. **Helpdesk Golden Run** — 32/32 capability checks pass against helpdesk.air output
2. **Complex Eval Corpus + Harness** — 5 complex prompts, replay mode 5/5 success
3. **Regression Guard** — `complex-readiness` script chains baseline + gaps + golden run

All 9 verification commands pass. Default CI: 937 passed, 4 skipped (941 total).

## Results

| # | Command | Result |
|---|---------|--------|
| 1 | `npx tsc --noEmit` | Clean |
| 2 | `npx vitest run` | 937 passed, 4 skipped (941 total) |
| 3 | `npm run quality-gate -- --mode offline` | PASS |
| 4 | `npm run test:complex-baseline` | 3/3 pass |
| 5 | `npm run test:complex-gaps` | 32/32 pass |
| 6 | `npm run helpdesk-golden` | PASS, 32/32 capabilities |
| 7 | `npm run eval-complex` | replay mode, 5/5 success |
| 8 | `npm run stability-sweep` | 12/12 |
| 9 | `npm run release-rehearsal -- --mode offline` | GO |

## C5.1 — Helpdesk Golden Run

### Design

`scripts/helpdesk-golden-run.ts` runs `examples/helpdesk.air` through the full pipeline (validate → repair → transpile → smoke → determinism), then verifies 32 capability checks across 10 groups (G1–G9, G12).

Checks replicate the exact substring patterns from `tests/complex-app-gaps.test.ts` to prevent drift. The `CAPABILITY_CHECKS` array is exported and reused by `tests/helpdesk-golden.test.ts` for structural validation.

### Results

- Pipeline: validate(PASS), repair(SKIP), transpile(PASS), smoke(PASS), determinism(PASS)
- Output: 35 files, 2403 lines
- Capabilities: 32/32 pass across all 10 groups
- Deterministic: yes
- Verdict: PASS

### Capability Groups

| Group | Name | Checks | Status |
|-------|------|--------|--------|
| G1 | Status workflow mutations | 4 | PASS |
| G2 | Aggregate consumption | 2 | PASS |
| G3 | Detail pages | 5 | PASS |
| G4 | Server-side filter/sort | 4 | PASS |
| G5 | RBAC UI gating | 3 | PASS |
| G6 | Nested CRUD | 2 | PASS |
| G7 | Form validation | 2 | PASS |
| G8 | DataTable column config | 3 | PASS |
| G9 | Pagination controls | 4 | PASS |
| G12 | Email route wiring | 3 | PASS |

## C5.2 — Complex Eval Corpus + Harness

### Corpus

`benchmarks/complex-eval-corpus.json` — 5 complex prompts with replay fixtures:

| ID | Category | Replay Fixture |
|----|----------|----------------|
| complex-helpdesk | support | examples/helpdesk.air |
| complex-projectmgmt | project | examples/projectflow.air |
| complex-ecommerce | commerce | examples/ecommerce.air |
| complex-hr-approvals | hr | examples/clinic.air |
| complex-saas-crm | saas | examples/crm.air |

### Harness

`scripts/eval-complex.ts` supports two modes:

- **Replay** (default, offline): reads `.air` fixture → `runLoopFromSource()` → classify outcome
- **Claude** (requires `ANTHROPIC_API_KEY`): generates via Claude → loop → classify

Reuses `loadCorpus`, `classifyOutcome`, `computeMetrics`, `buildReport` from `eval-online.ts`.

### Replay Results

All 5 cases: `success_running_app` — 100% prompt-to-running-app rate.

## C5.3 — Regression Guard Layers

Three layers prevent capability regressions:

1. **CI tests** (`tests/helpdesk-golden.test.ts`) — included in default `npx vitest run`, validates 32 checks pass
2. **Gap acceptance tests** (`npm run test:complex-gaps`) — 32 targeted acceptance criteria
3. **Composite command** (`npm run complex-readiness`) — chains baseline + gaps + golden run

## Verification Commands

```bash
npx tsc --noEmit                              # TypeScript clean
npx vitest run                                # 937 passed, 4 skipped (941 total)
npm run quality-gate -- --mode offline        # PASS
npm run test:complex-baseline                 # 3/3 pass
npm run test:complex-gaps                     # 32/32 pass
npm run helpdesk-golden                       # PASS, 32/32 capabilities
npm run eval-complex                          # replay mode, 5/5 success
npm run stability-sweep                       # 12/12
npm run release-rehearsal -- --mode offline   # GO
```

## Files Changed

| File | Action |
|------|--------|
| `benchmarks/complex-eval-corpus.json` | Created |
| `docs/helpdesk-golden-result.schema.json` | Created |
| `docs/complex-eval-result.schema.json` | Created |
| `scripts/helpdesk-golden-run.ts` | Created |
| `scripts/eval-complex.ts` | Created |
| `tests/helpdesk-golden.test.ts` | Created |
| `package.json` | Modified (+3 scripts) |
| `docs/c5-flagship-demo-eval-report.md` | Created |

No existing source files modified — no transpiler changes, no test changes to existing files.

## Remaining Items

- A8 live rehearsal (out of scope for C5)
