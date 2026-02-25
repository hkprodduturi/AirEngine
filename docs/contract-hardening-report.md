# Contract Hardening Report (CH-1 through CH-4)

## Summary

Fixed the MCP `air_loop` `repair_attempts` schema mismatch and upgraded all schema validation (tests + foundation gate) from shallow required-field checks to recursive JSON Schema validation.

## What Changed

### CH-1: MCP `air_loop` repair_attempts snake_case mapping

**Problem**: `src/mcp/server.ts` passed `result.repairAttempts` through directly with camelCase field names. `docs/loop-result.schema.json` expects snake_case.

**Fix**: Added explicit mapping in `src/mcp/server.ts`:

Before (camelCase — schema-incompatible):
```json
{
  "attemptNumber": 1,
  "errorsBefore": 2,
  "errorsAfter": 0,
  "sourceHash": "abc...",
  "durationMs": 5,
  "stopReason": "success"
}
```

After (snake_case — schema-compliant):
```json
{
  "attempt": 1,
  "errors_before": 2,
  "errors_after": 0,
  "source_hash": "abc...",
  "duration_ms": 5,
  "stop_reason": "success"
}
```

Internal `RepairAttempt` type in `src/cli/loop.ts` remains camelCase (internal data model unchanged).

### CH-2: Real JSON Schema validation in tests

**Added** `tests/schema-validator.ts` — shared recursive JSON Schema validator supporting: `type`, `required`, `properties`, `additionalProperties`, `items`, `enum`, `const`, `pattern`, `minimum`, `oneOf`, `$ref`/`$defs`.

**Added** 6 new schema conformance tests in `tests/mcp.test.ts`:
- Valid source response validates against `loop-result.schema.json`
- Repairable source with `max_repair_attempts=2` validates (exercises `repair_attempts`)
- Unrepairable source response validates
- `repair_mode=none` response validates
- `DiagnosticResult` (clean) validates against `diagnostics.schema.json`
- `DiagnosticResult` (with diagnostics) validates against `diagnostics.schema.json`

**Fixed** validator edge case: `undefined` values in objects (e.g., `sourceLine: undefined`) are now treated as absent, matching JSON serialization behavior.

### CH-3: Foundation gate real schema validation

**Upgraded** `scripts/foundation-check.ts` schema-sanity step:
- Replaced inline validator with shared `tests/schema-validator.ts`
- Live `DiagnosticResult` from `examples/todo.air` validated against full schema (not just required fields)
- Live `LoopResult` from `runLoop('examples/todo.air')` validated against full schema
- **New**: Live multi-attempt `LoopResult` from `runLoopFromSource('@state{x:int}', ..., { maxRepairAttempts: 2 })` validated, confirming `repair_attempts` snake_case shape passes

Foundation gate schema-sanity now validates 3 live payloads:
1. `diagnostics_live` — DiagnosticResult vs `diagnostics.schema.json`
2. `loop_live` — valid LoopResult vs `loop-result.schema.json`
3. `loop_repair_attempts` — multi-attempt LoopResult with populated `repair_attempts` vs `loop-result.schema.json`

### CH-4: This report

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/mcp/server.ts` | Modified (prior commit) | snake_case mapping for `repair_attempts` |
| `tests/schema-validator.ts` | Created | Shared recursive JSON Schema validator |
| `tests/mcp.test.ts` | Modified | 6 new schema conformance tests, snake_case assertions |
| `scripts/foundation-check.ts` | Modified | Shared validator import, repair_attempts validation case |
| `docs/contract-hardening-report.md` | Created | This report |

## Verification

```
$ npx tsc --noEmit
# exit 0

$ npx vitest run
# 711 tests, 10 suites, 0 failures, exit 0

$ node --import tsx scripts/eval-local.ts
# 6/6 pass, exit 0

$ node --import tsx scripts/foundation-check.ts
# 4/4 steps pass (type-check, test-suite, eval-harness, schema-sanity), exit 0
# schema-sanity details:
#   diagnostics_live: validated
#   loop_live: validated
#   loop_repair_attempts: validated
#   loop_repair_attempts_populated: true
```

## Test Count Breakdown

| Suite | Count | Delta |
|-------|-------|-------|
| tests/lexer.test.ts | 27 | — |
| tests/parser.test.ts | 72 | — |
| tests/transpiler.test.ts | 167 | — |
| tests/backend.test.ts | 233 | — |
| tests/mcp.test.ts | 55 | +6 (schema conformance) |
| tests/diagnostics.test.ts | 58 | — |
| tests/conformance.test.ts | 42 | — |
| tests/snapshots.test.ts | 10 | — |
| tests/bench.test.ts | 9 | — |
| tests/repair.test.ts | 38 | — |
| **Total** | **711** | **+6** |

## Schemas

Both schemas remain at `v1.0`. No breaking changes. The `repair_attempts` array and `repairAttempt` definition were added in A3d (additive, non-breaking).
