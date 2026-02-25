# A4c — CI + Budget Gates for Online/Offline Split

## Summary

Implements a unified quality gate system that splits gates into offline (always runnable, no secrets) and online (optional/nightly, requires `ANTHROPIC_API_KEY`). Adds regression comparison for A6c online eval reports to track the north-star metric.

## Files Created

| File | Purpose |
|------|---------|
| `scripts/eval-online-compare.ts` | Online eval report regression comparator |
| `scripts/quality-gate.ts` | Unified gate runner (offline/online/nightly/auto) |
| `docs/quality-gate-result.schema.json` | JSON Schema for gate report |
| `docs/online-eval-regression-policy.md` | Regression detection policy |
| `tests/ci-gates.test.ts` | 38 tests for comparator + gate runner |
| `docs/a4c-ci-budget-gates-report.md` | This report |

Also modified: `package.json` (added `eval-online-compare` and `quality-gate` scripts).

## Commands

```bash
# Offline gate (default, no secrets needed)
npx tsx scripts/quality-gate.ts --mode offline

# Auto mode (offline always, online if key present)
npx tsx scripts/quality-gate.ts --mode auto

# Online mode (requires ANTHROPIC_API_KEY)
npx tsx scripts/quality-gate.ts --mode online --online-limit 2

# Nightly mode (online + verbose)
npx tsx scripts/quality-gate.ts --mode nightly

# Compare two online eval reports
npx tsx scripts/eval-online-compare.ts <previous.json> <current.json>

# Self-compare (should always pass)
npx tsx scripts/eval-online-compare.ts report.json report.json
```

## Gate Modes

| Mode | Offline | Online | Behavior |
|------|---------|--------|----------|
| `offline` | Always | Never | Foundation + eval-local + benchmark compare |
| `online` | Always | Always | Offline + eval-online + online compare |
| `nightly` | Always | Always | Same as online with verbose output |
| `auto` | Always | If key | Offline always; online only if `ANTHROPIC_API_KEY` set |

## Offline Gate Steps

1. **foundation-check** — tsc + vitest + eval-local + schema sanity
2. **eval-local** — 6 local quality checks
3. **benchmark-compare** — timing regression vs baseline (skipped if no baseline)

## Online Gate Steps (added after offline)

4. **eval-online** — run benchmark corpus through Claude pipeline
5. **eval-online-compare** — compare against baseline (skipped if no baseline)

## Regression Thresholds (Defaults)

| Metric | Threshold | Type |
|--------|-----------|------|
| North-star success rate | -10pp | Hard fail |
| AIR success rate | -10pp | Hard fail |
| Timing (avg/p50/p95) | 2.0x AND +1000ms | Hard fail |
| Token usage | 2.0x | Soft warning |
| Corpus mismatch | non-strict | Soft warning |

All thresholds configurable via CLI flags. See `docs/online-eval-regression-policy.md`.

## Missing-Key Behavior

| Mode | Key Missing | Result |
|------|-------------|--------|
| `offline` | N/A | Runs normally |
| `auto` | Missing | Online skipped, offline runs |
| `online` | Missing | Online step fails |
| `nightly` | Missing | Online step fails |

## Report Artifacts

| Artifact | Path |
|----------|------|
| Gate report | `artifacts/gates/quality-gate-report.json` |
| Foundation report | `artifacts/foundation/foundation-check-report.json` |
| Local eval report | `artifacts/eval/local-eval-report.json` |
| Online eval report | `artifacts/eval/online-eval-report.json` |
| Online compare | `artifacts/eval/online-eval-compare.json` |

## Baseline Update Workflow

```bash
# Generate new online eval report
ANTHROPIC_API_KEY=... npx tsx scripts/eval-online.ts --verbose

# Review metrics
cat artifacts/eval/online-eval-report.json | jq '.metrics'

# Promote to baseline
cp artifacts/eval/online-eval-report.json artifacts/eval/online-eval-baseline.json
```

## Verification

| Step | Command | Expected |
|------|---------|----------|
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Tests | `npx vitest run` | all pass |
| eval-local | `npx tsx scripts/eval-local.ts` | 6/6 pass |
| foundation-check | `npx tsx scripts/foundation-check.ts` | 4/4 pass |
| eval-online dry-run | `npx tsx scripts/eval-online.ts --dry-run` | exit 0 |
| Self-compare | `npx tsx scripts/eval-online-compare.ts <f> <f>` | exit 0 |
| Offline gate | `npx tsx scripts/quality-gate.ts --mode offline` | exit 0 |
| Auto gate (no key) | `npx tsx scripts/quality-gate.ts --mode auto` | online skipped, exit 0 |

## Test Coverage

38 tests covering:
- Report loading (valid, wrong version, missing fields)
- Corpus matching (identical, id/entries/limit mismatches)
- Rate comparison (no regression, hard regression, soft regression, improvement)
- Timing comparison (stable, hard regression, below min abs threshold)
- Token comparison (doubled, stable)
- Failure breakdown deltas
- Full report comparison (self-compare, north-star regression, corpus mismatch soft/strict, threshold overrides)
- Gate mode resolution (auto with/without key, explicit modes)
- Step execution (pass, fail, skip)
- Step summarization (counts, empty)
- Report building (pass/fail verdict, online summary, skipped reasons)
- Schema conformance (offline, auto-skip, online with regression)
