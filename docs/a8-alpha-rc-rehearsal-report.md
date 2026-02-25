# A8 — Alpha RC Rehearsal + Baseline Freeze Report

## Summary

A8 adds release rehearsal tooling that orchestrates the full AirEngine quality pipeline into a single go/no-go command. No new features — purely release-execution infrastructure.

## What Was Built

### Rehearsal Runner (`scripts/release-alpha-rehearsal.ts`)

A 6-stage orchestrator that runs the complete quality pipeline:

1. **Doctor** — environment readiness check
2. **Offline Gates** — foundation check + eval-local + benchmark compare
3. **Canonical Demo** — fullstack-todo replay pipeline
4. **Online Eval** — live LLM generation + loop (full mode only)
5. **Online Compare** — regression detection against committed baseline (full mode only)
6. **Baseline Freeze** — auto-freeze first successful eval as baseline (full mode only)

CLI: `npm run release-rehearsal -- [--mode offline|full] [--online-limit N] [--verbose] [--fail-fast]`

### Reuse

The runner reuses `runStep`, `skipStep`, and `summarizeSteps` from `quality-gate.ts` — no new step type was introduced. The `GateStep` and `GateSummary` types are shared.

### Mode Resolution

- `--mode offline` (default): runs stages 1-3, skips 4-6
- `--mode full`: runs all 6 stages; downgrades to offline if `ANTHROPIC_API_KEY` is absent

### Baseline Management

- Committed stub: `benchmarks/online-eval-baseline-alpha.json` — zero-metric placeholder conforming to `OnlineEvalReport` schema
- `_provenance` envelope: `frozen_at`, `git_commit`, `source_report` — safely ignored by `loadReport()`
- Auto-freeze: when full-mode eval passes and no valid baseline exists, the runner copies the eval report to the baseline path

### Report Shape

`RehearsalReport` includes: schema_version, mode, effective_mode, run_metadata, steps, stage_summaries (6 categories), baseline validation, verdict, go_no_go (GO/NO-GO), skipped_reasons, artifact_paths, total_duration_ms.

Schema: `docs/alpha-rc-rehearsal-result.schema.json`

## Files Changed

| File | Action |
|------|--------|
| `scripts/release-alpha-rehearsal.ts` | Created — orchestrator |
| `tests/rehearsal.test.ts` | Created — ~28 tests |
| `benchmarks/online-eval-baseline-alpha.json` | Created — stub baseline |
| `docs/alpha-rc-rehearsal-result.schema.json` | Created — JSON Schema |
| `docs/a8-alpha-rc-rehearsal-report.md` | Created — this report |
| `docs/online-eval-regression-policy.md` | Modified — appended baseline freeze policy (5 sections) |
| `package.json` | Modified — added `release-rehearsal` script |
| `scripts/doctor.ts` | Modified — added 3 new required files |

## Test Coverage

28 tests in `tests/rehearsal.test.ts`:

| Group | Count |
|-------|-------|
| resolveRehearsalMode | 3 |
| aggregateSteps | 4 |
| computeVerdict | 5 |
| validateBaseline | 5 |
| buildRehearsalReport | 4 |
| Schema conformance | 3 |
| Re-exported utilities | 2 |
| Committed baseline stub | 3 |

All tests are network-free and deterministic.

## Verification

```
npx tsc --noEmit                                           → exit 0
npx vitest run                                             → all pass
npm run doctor                                             → verdict PASS
npm run release-rehearsal -- --mode offline                 → verdict PASS (GO)
npm run quality-gate -- --mode offline                      → 3/3 PASS
npm run demo-live-canonical -- --adapter replay             → PASS
```
