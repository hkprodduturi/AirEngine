# A6c — Online Eval / Success-Rate Harness

## Summary

Implements a structured online eval harness that runs a benchmark corpus through the real Claude pipeline (generate + loop) and records the north-star metric: **what % of prompts produce a running app end-to-end?**

## Files Created

| File | Purpose |
|------|---------|
| `benchmarks/online-eval-corpus.json` | 10 benchmark prompts across 3 complexity tiers |
| `scripts/eval-online.ts` | Online eval runner script |
| `docs/online-eval-result.schema.json` | JSON Schema for structured eval results |
| `tests/eval-online.test.ts` | 27 tests: corpus, classification, aggregation, schema conformance |
| `docs/a6c-online-eval-report.md` | This report |

Also modified: `package.json` (added `eval-online` npm script).

## Commands

```bash
# Dry run — validate corpus, no API calls
npx tsx scripts/eval-online.ts --dry-run

# Run without API key — structured failure report, exit 1
npx tsx scripts/eval-online.ts

# Run with limit
ANTHROPIC_API_KEY=sk-... npx tsx scripts/eval-online.ts --limit 2 --verbose

# Full run
ANTHROPIC_API_KEY=sk-... npx tsx scripts/eval-online.ts

# Via npm script
npm run eval-online -- --dry-run
```

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--corpus <path>` | `benchmarks/online-eval-corpus.json` | Corpus file |
| `--limit <n>` | all | Max prompts to run |
| `--repair-mode` | `deterministic` | `deterministic\|claude\|none` |
| `--max-repair-attempts` | `1` | 1-5 |
| `--generator-model` | adapter default | Claude model for generation |
| `--repair-model` | adapter default | Claude model for repair |
| `--timeout-ms` | `30000` | Generation timeout |
| `--provider-retries` | `2` | Generation provider retries |
| `--repair-provider-retries` | `2` | Repair provider retries |
| `--output <path>` | `artifacts/eval/online-eval-report.json` | Report path |
| `--verbose` | false | Print per-case stage details |
| `--dry-run` | false | Validate corpus only, no API calls |

## Key Metrics

- **prompt_to_air_success_rate**: Fraction of prompts where generation produced valid .air source
- **prompt_to_running_app_success_rate**: North-star metric — fraction producing a full passing pipeline
- **timing**: avg, p50, p95 for total duration, generation, and loop stages
- **tokens**: total and average input/output token consumption
- **retries**: average generation attempts and repair attempts
- **failure_breakdown**: Count per outcome category (10 categories)

## Outcome Categories

| Category | Meaning |
|----------|---------|
| `success_running_app` | All pipeline stages passed |
| `generation_failed_auth` | API key invalid (401/403) |
| `generation_failed_provider` | HTTP error or timeout from provider |
| `generation_failed_invalid_air` | Generated text didn't parse as valid AIR |
| `loop_failed_validation` | Validation failed, repair didn't compensate |
| `loop_failed_repair` | Repair stage itself failed |
| `loop_failed_transpile` | Transpilation failed |
| `loop_failed_smoke` | Smoke tests failed |
| `loop_failed_determinism` | Determinism check failed |
| `unexpected_error` | Uncaught exception |

## Report Location

`artifacts/eval/online-eval-report.json`

## Verification

| Step | Command | Expected |
|------|---------|----------|
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Tests | `npx vitest run` | all pass |
| Dry run | `npx tsx scripts/eval-online.ts --dry-run` | corpus validated, exit 0 |
| No key | `npx tsx scripts/eval-online.ts` | structured failure, exit 1 |
| Live (optional) | `npx tsx scripts/eval-online.ts --limit 2` | report written, exit 0 |

## Test Coverage

27 tests covering:
- Corpus loading (valid, limited, invalid shape, missing fields)
- Outcome classification (success, auth fail, provider fail, invalid AIR, each loop stage, repair compensation, unexpected error)
- Metric aggregation (all success, mixed, empty, single, token sums)
- Report building (complete, with/without git commit)
- Schema conformance (full report, repair fields, empty report)
- Env-gated live run
