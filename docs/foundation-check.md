# Foundation Gate Command (A6b)

## Purpose

Single command to verify the entire AirEngine foundation is healthy.
Intended as the CI gate — if this passes, the codebase is stable.

## Usage

```bash
# Run all 4 steps
node --import tsx scripts/foundation-check.ts

# With stdout/stderr in report
node --import tsx scripts/foundation-check.ts --verbose

# Stop on first failure
node --import tsx scripts/foundation-check.ts --fail-fast

# npm script
npm run foundation-check
```

## Steps

| # | Name | Command | What it checks |
|---|------|---------|----------------|
| 1 | type-check | `npx tsc --noEmit` | TypeScript compiles without errors |
| 2 | test-suite | `npx vitest run` | All tests pass |
| 3 | eval-harness | `node --import tsx scripts/eval-local.ts` | 6 eval checks pass |
| 4 | schema-sanity | (inline) | JSON schemas parse, have required fields, and live outputs validate |

### Schema Sanity Details

- Parses `docs/diagnostics.schema.json` and `docs/loop-result.schema.json` as valid JSON
- Checks structural fields (`$schema`, `type`, `properties`/`$defs`)
- Generates a real `DiagnosticResult` from `examples/todo.air` and validates required fields
- Runs `runLoop('examples/todo.air', tmpDir)` and validates required fields against `loop-result.schema.json`

## Output

Report: `artifacts/foundation/foundation-check-report.json`

```typescript
interface FoundationReport {
  timestamp: string;
  airengineVersion: string;
  nodeVersion: string;
  platform: string;
  steps: StepResult[];
  summary: { total, passed, failed, skipped, durationMs };
  verdict: 'pass' | 'fail';
}
```

## Exit Codes

- `0` — all steps pass
- `1` — any step failed
