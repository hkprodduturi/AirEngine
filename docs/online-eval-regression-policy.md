# Online Eval Regression Policy

## Overview

This document defines the regression detection policy for AirEngine's online eval harness (A6c). It governs how `eval-online-compare.ts` determines whether a new eval run represents a regression from the baseline.

## Hard Gates (default: fail)

These regressions cause the comparator to exit non-zero.

| Metric | Threshold | Description |
|--------|-----------|-------------|
| `prompt_to_running_app_success_rate` | -10pp | North-star metric: drop of >10 percentage points = hard fail |
| `prompt_to_air_success_rate` | -10pp | Generation quality: drop of >10 percentage points = hard fail |
| Timing (avg/p50/p95) | 2.0x AND +1000ms | Both ratio and absolute delta must exceed thresholds |
| Corpus mismatch (strict mode) | exact match | Only when `--strict-corpus` is enabled |

## Soft Warnings (default: non-fail)

These are reported but do not cause a non-zero exit code.

| Metric | Threshold | Description |
|--------|-----------|-------------|
| Minor rate drops | < threshold | Any drop below the hard threshold is a soft warning |
| Token increases | 2.0x | avg_input or avg_output doubles = soft warning |
| Corpus mismatch (non-strict) | any | Reported as warning, not failure |

## Why Percentage/Range Thresholds

Online eval relies on an external LLM provider, which introduces inherent variability:

- **Model behavior variance**: Even with temperature=0, minor API version changes can shift outputs
- **Timing variance**: Network latency, provider load, and queue depth cause timing jitter
- **Token variance**: Slightly different outputs produce different token counts

Exact-match thresholds would cause constant false positives. Range-based thresholds absorb normal provider variance while catching genuine regressions.

## Default Thresholds

All thresholds are configurable via CLI flags on `eval-online-compare.ts`:

```
--success-rate-threshold 0.1    # 10pp (0.0-1.0 scale)
--air-rate-threshold 0.1        # 10pp
--timing-ratio-threshold 2.0    # 2x slower
--timing-min-abs-ms 1000        # ignore < 1s delta
--token-ratio-threshold 2.0     # 2x increase
--strict-corpus                 # corpus mismatch = hard fail
```

## Baseline Update Process

### When to Update

- After a deliberate change to the generator, repair adapter, or pipeline logic
- After updating the benchmark corpus
- After a model version upgrade
- After verifying that a new baseline reflects expected behavior (not a degradation)

### How to Update

```bash
# Run online eval to generate a new report
ANTHROPIC_API_KEY=... npx tsx scripts/eval-online.ts --verbose

# Review the report
cat artifacts/eval/online-eval-report.json | jq '.metrics'

# Promote to baseline
cp artifacts/eval/online-eval-report.json artifacts/eval/online-eval-baseline.json
```

### Baseline Storage

- **Local**: `artifacts/eval/online-eval-baseline.json` (gitignored, developer-local)
- **CI**: Store in CI artifact cache or a dedicated baseline branch
- **Versioned**: Commit to repo only when the baseline represents a verified quality bar

## Failure Breakdown Monitoring

The comparator reports per-category failure deltas but does not hard-fail on individual category shifts. This is intentional — a regression in one category might be offset by improvement in another.

Monitor these for trends:
- `generation_failed_invalid_air` increasing: generator quality declining
- `loop_failed_transpile` increasing: transpiler regression (should be caught by offline gates)
- `generation_failed_provider` increasing: provider reliability issue (not our regression)
