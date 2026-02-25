# A5d — Canonical Live Demo Pipeline

## Summary

Implements a single-command canonical demo pipeline: prompt -> generate .air -> loop pipeline -> structured artifacts. Supports Claude (live) and replay (fallback/CI) adapters with bounded failure handling and operator guidance.

## Files Created

| File | Purpose |
|------|---------|
| `scripts/demo-live-canonical.ts` | Canonical demo runner (replay + Claude adapters) |
| `benchmarks/canonical-demo-prompt.json` | Versioned canonical prompt with metadata |
| `docs/canonical-live-demo-result.schema.json` | JSON Schema for demo results |
| `docs/canonical-live-demo-runbook.md` | Operator-ready demo runbook |
| `tests/demo-live.test.ts` | 23 tests (args, prompts, outcomes, schema, replay integration) |
| `docs/a5d-canonical-live-demo-report.md` | This report |

Also modified: `package.json` (added `demo-live-canonical` npm script).

## Commands

```bash
# Replay fallback (always works, no API key)
npx tsx scripts/demo-live-canonical.ts --adapter replay

# Live Claude demo
ANTHROPIC_API_KEY=... npx tsx scripts/demo-live-canonical.ts --adapter claude

# Claude with repair
ANTHROPIC_API_KEY=... npx tsx scripts/demo-live-canonical.ts \
  --adapter claude --repair-mode claude --max-repair-attempts 2 --verbose

# Missing key (structured failure)
npx tsx scripts/demo-live-canonical.ts --adapter claude
# -> exit 1, structured report, fallback hint
```

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--adapter` | `replay` | `replay` or `claude` |
| `--prompt` | canonical | Override prompt text |
| `--prompt-file` | - | Load prompt from file |
| `--repair-mode` | `deterministic` | `deterministic\|claude\|none` |
| `--max-repair-attempts` | `1` | 1-5 |
| `--generator-model` | adapter default | Claude model |
| `--repair-model` | adapter default | Claude repair model |
| `--timeout-ms` | `30000` | Generation timeout |
| `--output-dir` | temp dir | Output directory |
| `--keep-output` | false | Don't cleanup output |
| `--verbose` | false | Stage details |
| `--output` | `artifacts/demo/canonical-live-demo-result.json` | Report path |

## Outcome Categories

| Outcome | Meaning |
|---------|---------|
| `success` | Generation + all pipeline stages passed |
| `generation_failed` | Generator produced no valid .air |
| `loop_failed` | Pipeline stage failed |
| `missing_api_key` | Claude adapter requested without key |
| `unexpected_error` | Uncaught exception |

## Artifacts

| Artifact | Path |
|----------|------|
| Demo result | `artifacts/demo/canonical-live-demo-result.json` |
| Generated .air | `artifacts/demo/generated.air` |
| Output files | temp dir (auto-cleaned unless `--keep-output`) |

## Verification

| # | Command | Result |
|---|---------|--------|
| 1 | `npx tsc --noEmit` | exit 0 |
| 2 | `npx vitest run` | 860 tests (856 pass, 4 skip), 15 files |
| 3 | `eval-local.ts` | 6/6 pass |
| 4 | `foundation-check.ts` | 4/4 PASS |
| 5 | `quality-gate.ts --mode offline` | 3/3 pass |
| 6 | `demo-live-canonical.ts --adapter replay` | SUCCESS, exit 0 |
| 7 | `demo-live-canonical.ts --adapter claude` (no key) | structured failure, exit 1 |

## Test Coverage

23 tests covering:
- Arg parsing (defaults, adapter, prompt override, all flags)
- Canonical prompt loading (valid file, missing file)
- Outcome classification (success, gen fail, loop fail, repair compensation, error)
- Result building (success, failure with error)
- Loop summary extraction
- Presenter summary formatting (success + failure)
- Schema conformance (success, failure, partial loop)
- Replay integration (fixture + full loop pipeline)
- Env-gated live Claude test

## North-Star Tie-In

This demo pipeline is the human-visible version of the A6c north-star metric: `prompt_to_running_app_success_rate`. Each successful demo run represents one data point on that metric. The replay fallback ensures demos are never blocked by provider variability.
