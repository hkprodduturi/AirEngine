# A3c — MCP Loop Tool Report

## Summary

Exposed the existing agent loop pipeline (validate → repair → transpile → smoke → determinism) as a structured MCP tool `air_loop`. The tool returns machine-friendly JSON compatible with the `LoopResult` semantics, using existing diagnostics (A1) and repair (A3b) contracts.

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `src/mcp/server.ts` | Modified | Added `air_loop` tool registration |
| `src/cli/loop.ts` | Modified | Extracted `runLoopFromSource()`, added `LoopOptions` |
| `docs/loop-result.schema.json` | Created | Versioned JSON Schema for loop result payload |
| `tests/mcp.test.ts` | Modified | Added 11 air_loop tests |
| `docs/a3c-mcp-loop-tool-report.md` | Created | This document |

## MCP Tool: `air_loop`

### Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source` | string | (required) | AIR source code to process |
| `output_dir` | string | `./output` | Directory to write generated files |
| `repair_mode` | `"deterministic"` \| `"none"` | `"deterministic"` | Repair mode: A3b rule-based or skip |
| `write_artifacts` | boolean | `true` | Write audit artifacts to disk |

### Output Shape

```json
{
  "schema_version": "1.0",
  "success": true,
  "stages": [
    { "name": "validate", "status": "pass", "durationMs": 1 },
    { "name": "repair", "status": "skip", "durationMs": 0 },
    { "name": "transpile", "status": "pass", "durationMs": 3 },
    { "name": "smoke", "status": "pass", "durationMs": 0 },
    { "name": "determinism", "status": "pass", "durationMs": 2 }
  ],
  "diagnostics": { "valid": true, "diagnostics": [], "summary": { ... }, ... },
  "transpile_summary": { "file_count": 9, "output_lines": 220 },
  "smoke_summary": { "status": "pass", "checks": { ... } },
  "determinism": { "sourceHash": "abc...", "outputHashes": { ... }, "deterministic": true },
  "artifact_dir": ".air-artifacts/2026-02-25T...",
  "output_dir": "./output"
}
```

### Sample Responses

#### Valid source

```json
{
  "schema_version": "1.0",
  "success": true,
  "stages": [
    { "name": "validate", "status": "pass", "durationMs": 1 },
    { "name": "repair", "status": "skip", "durationMs": 0 },
    { "name": "transpile", "status": "pass", "durationMs": 3 },
    { "name": "smoke", "status": "pass", "durationMs": 0 },
    { "name": "determinism", "status": "pass", "durationMs": 2 }
  ],
  "diagnostics": { "valid": true, "diagnostics": [], "summary": { "errors": 0, "warnings": 1, "info": 1 } },
  "transpile_summary": { "file_count": 9, "output_lines": 220, "compression_ratio": 55 },
  "smoke_summary": { "status": "pass" },
  "determinism": { "sourceHash": "...", "deterministic": true }
}
```

#### Repairable invalid source (E001+E002)

```json
{
  "schema_version": "1.0",
  "success": true,
  "stages": [
    { "name": "validate", "status": "fail", "durationMs": 0 },
    { "name": "repair", "status": "pass", "durationMs": 5 },
    { "name": "transpile", "status": "pass", "durationMs": 2 },
    { "name": "smoke", "status": "pass", "durationMs": 0 },
    { "name": "determinism", "status": "pass", "durationMs": 1 }
  ],
  "repair_result": {
    "status": "repaired",
    "attempted": true,
    "source_changed": true,
    "applied_count": 2,
    "skipped_count": 0,
    "applied_actions": [
      { "rule": "AIR-E001", "kind": "prepend", "description": "Prepend missing @app:name declaration" },
      { "rule": "AIR-E002", "kind": "append", "description": "Append missing @ui block" }
    ],
    "skipped_actions": []
  },
  "transpile_summary": { "file_count": 9, "output_lines": 348 }
}
```

#### Unrepairable invalid source

```json
{
  "schema_version": "1.0",
  "success": false,
  "stages": [
    { "name": "validate", "status": "fail", "durationMs": 0 },
    { "name": "repair", "status": "fail", "durationMs": 0 }
  ],
  "diagnostics": { "valid": false, "diagnostics": [{ "code": "AIR-P002", "severity": "error", ... }] },
  "determinism": { "sourceHash": "...", "outputHashes": {}, "deterministic": true }
}
```

## Architecture: `runLoopFromSource()`

The existing `runLoop(file, outputDir)` was refactored to delegate to a new `runLoopFromSource(source, outputDir, opts?)` function. This avoids temp-file overhead for the MCP path while keeping the CLI unchanged.

```
CLI (runLoop)  ──reads file──> runLoopFromSource(source, outputDir, opts)
MCP (air_loop) ──────────────> runLoopFromSource(source, outputDir, opts)
```

`LoopOptions` supports:
- `repairMode`: `'deterministic'` (default) or `'none'`
- `writeArtifacts`: `true` (default) or `false`

## Schema Reference

- **Loop result**: `docs/loop-result.schema.json` (version 1.0)
- **Diagnostics**: `docs/diagnostics.schema.json` (version 1.0)

## Commands Run

```bash
# Type check
npx tsc --noEmit                                    # clean

# MCP tests
npx vitest run tests/mcp.test.ts                    # 46 passed (35 existing + 11 new)

# Repair tests (no regression)
npx vitest run tests/repair.test.ts                 # 27 passed

# Full test suite
npx vitest run                                      # 691 passed (10 files)

# Eval gate
npm run eval-local                                  # 6/6 passed
```

## Test Results

```
tests/mcp.test.ts — air_loop tool logic (11 new tests)
  - valid source → loop succeeds with all stages pass
  - repairable invalid source (E001+E002) → repair succeeds → loop succeeds
  - unrepairable invalid source → loop fails gracefully with structured output
  - returned diagnostics conform to diagnostics contract shape
  - returned loop result conforms to loop-result.schema.json required fields
  - repair_mode=none skips repair
  - artifact directory created when write_artifacts=true
  - repair artifacts included on attempted repair
  - deterministic flag and hash surfaced in response
  - no hidden text-only errors (always structured)
  - MCP server registers air_loop tool

Full suite: 691 tests, 10 files, 0 failures
Eval gate: 6/6 checks passed
```

## Known Limitations

1. **No online LLM repair**: Repair is deterministic A3b only (E001, E002). No iterative or model-based repair.
2. **Single-pass repair**: One repair attempt per loop run.
3. **Source-only input**: MCP tool accepts `source` string only (no file path mode). The CLI `runLoop` handles file paths.
4. **No streaming**: Full response returned at once (no partial stage updates).
5. **Output files always written**: When transpile succeeds, output files are written to `output_dir`. There is no dry-run mode yet.
