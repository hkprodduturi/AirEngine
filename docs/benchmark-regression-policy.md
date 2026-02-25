# Benchmark Regression Policy (A4b)

## Purpose

Detect performance regressions between benchmark runs to prevent slow creep.

## Usage

```bash
# Compare two benchmark files
node --import tsx scripts/benchmark-compare.ts <previous.json> <current.json>

# Custom thresholds
node --import tsx scripts/benchmark-compare.ts prev.json curr.json --threshold 2.0 --min-abs 10

# npm script
npm run benchmark-compare -- artifacts/eval/benchmark-baseline.json artifacts/eval/benchmark-baseline.json
```

## Regression Detection

A file is flagged as regressed when ALL of these hold:

1. `delta > 0` (current is slower)
2. `delta >= minAbsMs` (default: 5ms — avoids noise)
3. `ratio >= threshold` (default: 1.5x — 50% slower)

### Hash Regression

Any file going from `hashStable: true` to `hashStable: false` is a regression.

### Budget Flags

These aggregate flags going `true → false` are also regressions:

| Flag | Meaning |
|------|---------|
| `allUnder200ms` | Every file completes in < 200ms |
| `cumulativeUnder500ms` | Total across all files < 500ms |
| `allHashStable` | Every file produces deterministic output |

## Output

Report: `artifacts/benchmarks/benchmark-compare.json`

## Exit Codes

- `0` — no regressions
- `1` — regressions detected
- `2` — usage error (missing arguments)
