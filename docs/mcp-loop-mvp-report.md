# MCP/Agent Loop Harness MVP Report

## Summary

The `air loop` CLI command implements a 5-stage pipeline for AI agent workflows:

```
validate → repair (stub) → transpile → smoke → determinism
```

On success, output files are written to the output directory after all stages complete.

All artifacts are logged to `.air-artifacts/<timestamp>/` for auditability.

## Command

```
air loop <file.air> [-o <output-dir>]
```

## Stages

Each stage is tracked with pass/fail/skip status and timing in the stage report.

| # | Stage | Description | Status |
|---|-------|-------------|--------|
| 1 | validate | Parse + diagnose → DiagnosticResult | Implemented |
| 2 | repair | Auto-fix diagnostics (LLM-assisted) | Stub — always skips |
| 3 | transpile | Generate output files from AST | Implemented |
| 4 | smoke | L0 (files exist) + L1 (entry point, package.json, non-trivial) | Implemented |
| 5 | determinism | Transpile twice, compare output hashes | Implemented |

After stages complete, output files are written to the target directory (not a tracked stage).

## Artifact Logging

Each run creates `.air-artifacts/<ISO-timestamp>/` containing:

| File | Contents |
|------|----------|
| `diagnostics.json` | Full DiagnosticResult (v2 format) |
| `output-hashes.json` | SHA-256 hashes of all generated files |
| `stage-report.json` | Per-stage pass/fail/skip + timing |
| `loop-result.json` | Complete LoopResult (all stages + metadata) |

## Smoke Checks

- **L0**: All files non-empty, file count > 0
- **L1**: Has entry point (App.jsx/main.jsx/index.html), has package.json, all files > 10 chars

## Determinism Checks

- Transpiles same AST twice, compares output file hashes
- Excludes `_airengine_manifest.json` (has timestamp)
- Reports `deterministic: true/false` in LoopResult

## Verification

### Pass case (todo.air)
```
air loop examples/todo.air -o /tmp/test
  PASS  validate (2ms)
  SKIP  repair (0ms)
  PASS  transpile (3ms)
  PASS  smoke (0ms)
  PASS  determinism (1ms)
  Output: 9 files, 395 lines
  Deterministic: yes
```

### Pass case (projectflow.air — complex)
```
air loop examples/projectflow.air -o /tmp/test2
  PASS  validate (11ms)
  SKIP  repair (0ms)
  PASS  transpile (13ms)
  PASS  smoke (0ms)
  PASS  determinism (5ms)
  Output: 44 files, 3177 lines
  Deterministic: yes
```

### Fail case (validation-error-no-ui.air)
```
air loop tests/fixtures/validation-error-no-ui.air -o /tmp/fail
Exit code: 1
  FAIL  validate (8ms)
  SKIP  repair (0ms)
  Diagnostics: 1 errors, 0 warnings
    error[AIR-E002]: No @ui block found
  Deterministic: yes
```

## Files

| File | Purpose |
|------|---------|
| `src/cli/loop.ts` | Loop harness implementation (stages, artifact logging, formatting) |
| `src/cli/index.ts` | CLI wiring (`air loop` command) |

## Test Suite
```
npx vitest run
Exit code: 0
Tests: 653 passed (653)
Suites: 9 passed (9)
Duration: 985ms
```
