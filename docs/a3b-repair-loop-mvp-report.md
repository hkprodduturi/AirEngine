# A3b — Agent Repair Loop MVP Report

## Summary

Implemented a deterministic, single-pass repair engine for the AirEngine agent loop. The repair engine fixes two blocking diagnostic codes (AIR-E001, AIR-E002) with explicit patch payloads, full audit trail, and no ambiguity.

## Supported Diagnostic Codes

| Code | Error | Repair | Kind | Exact Text |
|------|-------|--------|------|------------|
| AIR-E001 | Missing `@app:name` declaration | Prepend `@app:myapp` | `prepend` | `@app:myapp\n` |
| AIR-E002 | No `@ui` block found | Append minimal `@ui` | `append` | `\n@ui(h1>"Hello World")` |

### Parse Error Handling

The parser throws `AirParseError("Missing @app declaration")` before the validator can produce AIR-E001. The repair engine detects this pattern in AIR-P* diagnostics (message contains "Missing @app") and treats it as an E001 equivalent.

Speculative E002 detection is narrowly scoped: only when the specific "Missing @app" parse error was repaired (not on any arbitrary parse error) AND the source lacks `@ui`. This prevents mutating malformed inputs for unrelated syntax errors.

## Skipped Codes (with reasons)

| Code | Reason |
|------|--------|
| AIR-E003 | Model reference is ambiguous — requires user intent |
| AIR-E004 | Duplicate page — choosing a new name is ambiguous |
| AIR-E005 | Nav ref — could add page or fix nav (ambiguous) |
| AIR-E007 | Model reference is ambiguous — requires user intent |
| AIR-E008 | Auth design is complex — requires user intent |
| AIR-P* | Parse errors — source is malformed, text patching is fragile |
| AIR-W* | Warnings are non-blocking — no repair needed |
| AIR-L* | Info-level — changes app behavior, non-blocking |

## Before/After Examples

### E001 + E002 (fixture: `repairable-e001-e002.air`)

**Before:**
```
@state{x:int}
```

**After repair:**
```
@app:myapp
@state{x:int}
@ui(h1>"Hello World")
```

### E002 only

**Before:**
```
@app:test
@state{x:int}
```

**After repair:**
```
@app:test
@state{x:int}
@ui(h1>"Hello World")
```

## Single-Pass Policy

One repair attempt per loop run. No iterative retries. If errors remain after one pass, the result reports `partial` or `failed` status and the loop exits gracefully.

## Artifact Paths and Structure

When repair is attempted, the following artifacts are **always** written to `.air-artifacts/<timestamp>/`, even when no patch could be applied (ensures full audit trail on failed repairs):

| File | Contents |
|------|----------|
| `repaired.air` | Repaired source text (only if source changed) |
| `repair-actions.json` | Full action list with applied/skipped flags and reasons |
| `diagnostics-before.json` | Original diagnostics (pre-repair) |
| `diagnostics-after.json` | Post-repair diagnostics |
| `diagnostics.json` | Original diagnostics (always written) |
| `loop-result.json` | Full loop result including repair metadata |

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `src/repair.ts` | Created | Repair engine: `planRepairs()` + `applyRepairs()` + `repair()` |
| `src/cli/loop.ts` | Modified | Integrated repair, extended LoopResult, artifact logging |
| `src/cli/index.ts` | Modified | Updated loop CLI exit logic (repair pass compensates validate fail) |
| `tests/repair.test.ts` | Created | 24 tests for repair rules, determinism, loop integration |
| `tests/fixtures/repairable-e001-e002.air` | Created | Dedicated fixture triggering E001+E002 |
| `docs/a3b-repair-loop-mvp-report.md` | Created | This document |

## Commands Run

```bash
# Type check
npx tsc --noEmit                                    # clean

# Repair tests
npx vitest run tests/repair.test.ts                 # 27 passed

# Full test suite
npx vitest run                                      # 680 passed (10 files)

# Eval gate
npm run eval-local                                  # 6/6 passed

# Manual verification
npx tsx src/cli/index.ts loop tests/fixtures/repairable-e001-e002.air -o .eval-tmp/repair-test
# → repair: 2 applied, transpile: 9 files, deterministic: yes
```

## Test Results

```
tests/repair.test.ts (27 tests)
  planRepairs (7 tests)
    - returns prepend action for AIR-E001
    - returns append action for AIR-E002
    - skips unsupported error codes with reason
    - skips non-@app parse error codes (AIR-P*) with reason
    - treats "Missing @app" parse error as E001
    - skips warnings (AIR-W*) with reason
    - skips info-level (AIR-L*) with reason
  applyRepairs (3 tests)
    - prepends text for E001 action
    - appends text for E002 action
    - handles both E001+E002 together
  repair() (4 tests)
    - returns noop when no errors
    - returns partial when mix of repairable and unrepairable
    - returns repaired when all errors are fixable
    - returns failed when no errors can be repaired
  Determinism (3 tests)
    - byte-identical output
    - identical action plan
    - consistent hash
  Loop integration (4 tests)
    - repairable-e001-e002.air → repaired → validates → transpiles
    - unsupported errors → loop exits with failed repair status
    - valid input → repair skip, no regression
    - repair artifacts written
  Edge cases (5 tests)
    - @app: with no name → prepends new @app:myapp
    - empty source → produces valid minimal app
    - duplicate diagnostic codes deduplicated
    - speculative E002 does NOT fire on unrelated parse errors
    - speculative E002 fires only when Missing @app was repaired
  Audit trail (1 test)
    - writes repair-actions.json and diagnostics-before.json even when repair fails

Full suite: 680 tests, 10 files, 0 failures
Eval gate: 6/6 checks passed
```

## Known Limitations

1. **Two codes only**: Only AIR-E001 and AIR-E002 are repaired. All other errors require user intent.
2. **Single-pass**: No iterative repair. If E001 fix reveals new errors beyond E002, they won't be fixed.
3. **Fixed app name**: E001 repair always uses `@app:myapp`. A smarter engine could derive the name from the filename.
4. **Fixed UI content**: E002 repair always uses `h1>"Hello World"`. A smarter engine could infer content from state/db.
5. **Parse error detection**: The "Missing @app" parse error is detected by message string matching, which could break if the parser message changes.
