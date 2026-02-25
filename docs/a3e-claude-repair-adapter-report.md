# A3e — Claude Repair Adapter Report

## Summary

Added the first LLM-backed repair adapter to AirEngine's pluggable repair system. The Claude repair adapter uses the Anthropic Messages API to fix errors in AIR source code, reusing the `extractAirSource()` and `tryParseAir()` quality gate from A5c. No new dependencies.

## Changes

| File | Action | Summary |
|------|--------|---------|
| `src/repair.ts` | Modified | Widened `RepairAction.kind` to include `'replace'`; widened `RepairAdapter.repair()` return type to `RepairResult \| Promise<RepairResult>` |
| `src/repair-claude.ts` | Created | Claude repair adapter: fetch + provider retries + parse quality gate |
| `src/cli/loop.ts` | Modified | `stageRepair()` → async; widened `LoopOptions.repairMode` to `'deterministic' \| 'claude' \| 'none'`; added `claudeRepairOptions`; dynamic import of Claude adapter; context forwarding |
| `src/mcp/server.ts` | Modified | Widened `repair_mode` zod enum; added `repair_model`, `repair_provider_retries`, `repair_timeout_ms` optional params |
| `src/cli/index.ts` | Modified | Added `--repair-mode`, `--max-repair-attempts`, `--claude-model` to `air loop` command |
| `docs/loop-result.schema.json` | Modified | Added `'replace'` to repair action kind enum |
| `tests/repair-claude.test.ts` | Created | 13 mocked-fetch tests + 1 env-gated live test |
| `docs/a3e-claude-repair-adapter-report.md` | Created | This report |

## Architecture

### Two-Layer Retry

```
Loop layer (maxRepairAttempts, default 1):
  For each attempt:
    → adapter.repair(source, diagnostics, context)
      Provider layer (maxRetries, default 2):
        For each provider attempt:
          → fetch() to Claude API
          ← 429/5xx/timeout? → retry provider
          ← 401/403? → fail immediately
          ← Success? → extract + parse gate → return RepairResult
    ← Re-diagnose repaired source
    ← Stop conditions: noop | success | no_improvement | cycle | max_attempts
```

### Adapter Behavior

- **No errors**: Returns `noop` without calling API
- **Auth error (401/403)**: Returns `failed` immediately, no retry
- **Transient error (429/5xx/timeout)**: Retries at provider level
- **Same source returned**: Returns `noop`
- **Changed + parse-valid**: Returns `repaired`
- **Changed + parse-invalid**: Returns `partial` (loop layer re-diagnoses)

### System Prompt

Repair-focused: fix only reported errors, preserve intent, no additions, output only corrected .air source.

## Backward Compatibility

- `RepairAction.kind: 'replace'` is naturally ignored by `applyRepairs()` (only acts on prepend/append)
- `RepairAdapter.repair()` returning `Promise<RepairResult>` is backward-compatible (`await syncValue` is a no-op)
- Default `repairMode` remains `'deterministic'`, `maxRepairAttempts` remains 1
- All existing paths unchanged — deterministic and noop adapters unaffected

## Verification

```
npx tsc --noEmit                          → exit 0
npx vitest run                            → 770 passed, 2 skipped (env-gated)
node --import tsx scripts/eval-local.ts   → 6/6 pass
node --import tsx scripts/foundation-check.ts → 4/4 pass (PASS)
```

## Test Summary (14 tests)

| # | Test | Assertion |
|---|------|-----------|
| 1 | has name "claude" | `adapter.name === 'claude'` |
| 2 | returns repaired for valid AIR | `status='repaired'`, `sourceChanged=true` |
| 3 | extracts from fenced code block | strips ``` fences |
| 4 | returns noop when source unchanged | `status='noop'` |
| 5 | returns partial when changed but parse-invalid | `status='partial'` |
| 6 | HTTP 401 fails immediately | `status='failed'`, fetch called once |
| 7 | HTTP 429 retries then succeeds | `status='repaired'`, fetch called twice |
| 8 | timeout returns failed | reason contains "timed out" |
| 9 | empty response returns failed | `status='failed'` |
| 10 | includes RepairContext in prompt | body contains "attempt 2 of 3" |
| 11 | respects custom model | body model matches |
| 12 | returns noop for no error diagnostics | no API call, `status='noop'` |
| 13 | loop integration with mock adapter | `repairAdapter` override, stop on success |
| 14 | (env-gated) repairs missing @app via live API | parses valid after repair |
