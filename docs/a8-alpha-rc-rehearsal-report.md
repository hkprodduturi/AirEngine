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

## Verification (Initial)

```
npx tsc --noEmit                                           → exit 0
npx vitest run                                             → all pass
npm run doctor                                             → verdict PASS
npm run release-rehearsal -- --mode offline                 → verdict PASS (GO)
npm run quality-gate -- --mode offline                      → 3/3 PASS
npm run demo-live-canonical -- --adapter replay             → PASS
```

## A8-prep Post-Sweep Rerun

A stability sweep (`scripts/stability-sweep.ts`) was run across all 7 showcase examples and 5 replay fixtures. The initial sweep found 3 P1 validator issues (AIR-E005 false positives on nav keywords, AIR-E008 false positive on external-auth pattern). Both were fixed in `src/validator/index.ts`.

Post-fix verification:

```
npx tsc --noEmit                                           → exit 0
npx vitest run                                             → 916 passed, 4 skipped (920 total, 18 files)
npm run stability-sweep                                    → 12/12 PASS, 0 issues
npm run release-rehearsal -- --mode offline                 → verdict PASS (GO)
npm run quality-gate -- --mode offline                      → 3/3 PASS
npm run demo-live-canonical -- --adapter replay             → PASS
```

Detailed results: `docs/a8-prep-stability-sweep-report.md`
Issue triage: `docs/a8-prep-issues.md`

## A8-final — Live Claude Rehearsal

_Status: PENDING — awaiting ANTHROPIC_API_KEY_

### Pre-flight (offline, verified green)

```
npx tsc --noEmit                                           → exit 0
npx vitest run                                             → 916 passed, 4 skipped (920 total, 18 files)
npm run doctor                                             → PASS (21 pass, 0 fail, 1 warn)
npm run quality-gate -- --mode offline                      → PASS (3/3)
npm run release-rehearsal -- --mode offline                 → GO
npm run stability-sweep                                    → 12/12 PASS
```

### Live Rehearsal Command

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run release-rehearsal -- --mode full --online-limit 3 --verbose
```

Expected stages:
1. doctor — PASS (environment ready)
2. offline-gates — PASS (foundation + eval-local + benchmark)
3. canonical-demo — PASS (replay path)
4. online-eval — Claude generates 3 prompts → loop pipeline (limited to 3 for cost control)
5. online-compare — compares against stub baseline (stub has 0 cases, so all metrics are "new")
6. baseline-freeze — SKIP (stub baseline is schema-valid; manual freeze required)

### Baseline Freeze Procedure (manual)

The auto-freeze skips because the stub baseline is schema-valid. After a successful live run:

```bash
# 1. Verify online-eval report was generated
cat artifacts/eval/online-eval-report.json | python3 -m json.tool | head -5

# 2. Copy eval report to baseline, adding provenance
node --import tsx -e "
import { readFileSync, writeFileSync } from 'fs';
const report = JSON.parse(readFileSync('artifacts/eval/online-eval-report.json', 'utf-8'));
report._provenance = {
  frozen_at: new Date().toISOString(),
  git_commit: require('child_process').execSync('git rev-parse --short HEAD', {encoding:'utf-8'}).trim(),
  source_report: 'artifacts/eval/online-eval-report.json',
  notes: 'First real baseline — replaces stub. A8-final live rehearsal.'
};
writeFileSync('benchmarks/online-eval-baseline-alpha.json', JSON.stringify(report, null, 2));
console.log('Baseline frozen.');
"

# 3. Verify baseline is valid
npm run release-rehearsal -- --mode offline
```

### Live Rehearsal Results

_To be filled after running with API key:_

| Stage | Status | Duration | Details |
|-------|--------|----------|---------|
| doctor | — | — | — |
| offline-gates | — | — | — |
| canonical-demo | — | — | — |
| online-eval | — | — | model: —, cases: —, north-star: — |
| online-compare | — | — | — |
| baseline-freeze | — | — | — |

### Online Eval Metrics

_To be filled:_

| Metric | Value |
|--------|-------|
| Total cases | — |
| Success count | — |
| Prompt→AIR rate | — |
| Prompt→Running App rate (north-star) | — |
| Avg total time | — |
| Avg generation time | — |

### Baseline Freeze

| Field | Value |
|-------|-------|
| File | `benchmarks/online-eval-baseline-alpha.json` |
| Status | STUB (awaiting replacement) |
| Source report | — |
| Frozen at | — |
| Git commit | — |

### Final Verdict

| Check | Status |
|-------|--------|
| Offline rehearsal | GO |
| Stability sweep (12/12) | PASS |
| Live rehearsal | PENDING |
| Baseline frozen (real) | PENDING |
| **Go / No-Go** | **PENDING** |

### Post-Baseline Verification Checklist

```bash
npx tsc --noEmit
npx vitest run
npm run doctor
npm run quality-gate -- --mode offline
npm run release-rehearsal -- --mode offline
```
