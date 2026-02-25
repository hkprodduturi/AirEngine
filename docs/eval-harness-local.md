# Local Eval / Regression Harness (A6a)

A single command that verifies the AI-first foundation: diagnostics contract stability, transpile determinism, corpus health, loop MVP behavior, and benchmark sanity.

## Quick Start

```bash
npm run eval-local
# or
npx tsx scripts/eval-local.ts
# verbose mode
npx tsx scripts/eval-local.ts --verbose
```

## Checks Performed

| # | Check | Category | What It Verifies |
|---|-------|----------|------------------|
| 1 | `diagnostics-schema-validation` | diagnostics | DiagnosticResult objects conform to `docs/diagnostics.schema.json` (required fields, types, enums, patterns) |
| 2 | `diagnostics-determinism` | diagnostics | Same `.air` input produces byte-identical diagnostics JSON on repeated runs |
| 3 | `corpus-smoke` | corpus | All core examples + 5 base templates parse/validate/transpile successfully; invalid fixtures produce expected errors; parse-error fixtures throw |
| 4 | `transpile-determinism` | determinism | Same AST + same compiler version produces identical output file hashes (excluding timestamped manifest) |
| 5 | `loop-mvp-smoke` | loop | Agent loop completes on valid input (all stages pass); fails gracefully on invalid input (validate stage fails, no transpile output) |
| 6 | `benchmark-baseline` | benchmark | All 7 core examples complete in <200ms each, <500ms cumulative; all hash-stable |

## Corpus Inputs

The harness uses only internal assets:

- **Core examples** (7): `examples/todo.air`, `expense-tracker.air`, `auth.air`, `dashboard.air`, `landing.air`, `fullstack-todo.air`, `projectflow.air`
- **Base templates** (first 5): `examples/base-*.air` (subset for runtime)
- **Valid fixtures**: `tests/fixtures/valid-minimal.air`
- **Validation-error fixtures**: `tests/fixtures/validation-error-*.air`
- **Lint-warning fixtures**: `tests/fixtures/lint-warning-*.air`
- **Parse-error fixtures**: `tests/fixtures/parse-error-*.air`

## Artifacts

| File | Description |
|------|-------------|
| `artifacts/eval/local-eval-report.json` | Machine-readable report with all check results, timing, and failure details |
| `artifacts/eval/benchmark-baseline.json` | Per-example benchmark metrics (parse/validate/transpile ms, hash stability) |

### Report Schema

```json
{
  "timestamp": "ISO-8601",
  "airengineVersion": "0.2.0",
  "nodeVersion": "v20.x.x",
  "platform": "darwin",
  "checks": [
    {
      "name": "diagnostics-schema-validation",
      "category": "diagnostics",
      "status": "pass | fail",
      "durationMs": 5,
      "details": { ... },
      "error": "only present on failure"
    }
  ],
  "summary": {
    "total": 6,
    "passed": 6,
    "failed": 0,
    "durationMs": 150
  },
  "commands": ["npx tsx scripts/eval-local.ts"]
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed |
| `1` | One or more checks failed |

## Determinism Policy

- Same `.air` source + same compiler version + same options = same output file hashes
- `_airengine_manifest.json` is excluded from hash comparison (contains timestamps)
- Same invalid input = same diagnostics JSON (byte-for-byte identical)
- Diagnostics are sorted deterministically: severity, then line number, then error code

## Example Output

```
  AirEngine Local Eval Harness (A6a)

  Running foundation checks...

  [1/6] Diagnostics schema validation...
        PASS  (3ms)
  [2/6] Diagnostics determinism...
        PASS  (2ms)
  [3/6] Corpus parse/validate/transpile smoke...
        PASS  (45ms)
  [4/6] Transpile determinism / hash stability...
        PASS  (30ms)
  [5/6] Loop MVP smoke (valid + invalid)...
        PASS  (15ms)
  [6/6] Benchmark baseline...
        PASS  (40ms)

  -------- Summary --------
  Total:   6 checks
  Passed:  6
  Failed:  0
  Time:    140ms
  Report:  artifacts/eval/local-eval-report.json
```

## CI Integration

The harness exits non-zero on failure and produces machine-readable JSON, making it suitable for CI pipelines:

```yaml
# GitHub Actions example
- name: Run eval harness
  run: npm run eval-local
- name: Upload eval report
  uses: actions/upload-artifact@v4
  with:
    name: eval-report
    path: artifacts/eval/
```
