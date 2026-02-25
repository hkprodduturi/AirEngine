# A8-prep — Stability Sweep Report

## Summary

A local stability sweep was run across all 7 showcase examples and 5 replay fixtures to validate the full loop pipeline (validate → repair → transpile → smoke → determinism) before finalizing the alpha RC.

**Result: 12/12 PASS, 0 issues outstanding.**

## Sweep Configuration

- **Mode**: offline (examples + replay fixtures, no live Claude generation)
- **AirEngine version**: 0.2.0
- **Node**: v20.17.0
- **Platform**: darwin

## Initial Run — 3 P1 Issues Found

The first sweep revealed 3 validation failures:

| Case | Error | Root Cause |
|------|-------|------------|
| showcase:auth | AIR-E005 | `@nav` references `@protected:/` and `redirect` — validator incorrectly flagged navigation directives/keywords as missing page names |
| showcase:dashboard | AIR-E008 | `@auth(required)` without `/login` route — validator treated external-auth pattern as an error |
| replay:dashboard | AIR-E008 | Same as above (dashboard.air via replay path) |

## Fixes Applied

### Fix 1: E005 Nav Reference Filter (`src/validator/index.ts`)

The E005 rule now skips references that are:
- Directive-prefixed (`@protected:...`)
- Path-like (containing `/` or `:`)
- Known navigation keywords: `redirect`, `back`, `reload`, `replace`, `push`, `pop`

### Fix 2: E008 → W008 Severity Downgrade (`src/validator/index.ts`)

`@auth(required)` without a login route in `@api` was downgraded from error (AIR-E008) to warning (AIR-W008). This is a legitimate pattern when using external auth providers.

### Fix 3: Test Update (`tests/diagnostics.test.ts`)

Updated the E008 test to expect the new W008 warning code and `warning` severity.

## Post-Fix Sweep — All Green

```
=== Stability Sweep Summary ===
Total: 12 cases — 12 success, 0 failed
  Showcase: 7/7
  Replay:   5/5
Duration: 87ms

No issues found.
```

### Per-Case Results

| Case | Source | Complexity | Outcome | Duration |
|------|--------|------------|---------|----------|
| showcase:todo | showcase | simple | success | 8ms |
| showcase:expense-tracker | showcase | simple | success | 4ms |
| showcase:landing | showcase | simple | success | 3ms |
| showcase:auth | showcase | medium | success | 6ms |
| showcase:dashboard | showcase | medium | success | 5ms |
| showcase:fullstack-todo | showcase | medium | success | 6ms |
| showcase:projectflow | showcase | complex | success | 22ms |
| replay:todo | replay | — | success | 2ms |
| replay:fullstack-todo | replay | — | success | 4ms |
| replay:landing | replay | — | success | 2ms |
| replay:dashboard | replay | — | success | 5ms |
| replay:expense-tracker | replay | — | success | 2ms |

All cases: deterministic, all pipeline stages pass or skip (repair skipped = clean parse).

## A8 Rerun Verification

After fixes, the full verification suite was re-run:

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 916 passed, 4 skipped (920 total, 18 files) |
| `npm run stability-sweep` | 12/12 PASS |
| `npm run release-rehearsal -- --mode offline` | GO |
| `npm run quality-gate -- --mode offline` | PASS (3/3) |
| `npm run demo-live-canonical -- --adapter replay` | PASS |

## Conclusion

All showcase examples and replay fixtures pass the full loop pipeline. The 3 P1 validator issues were root-caused and fixed. No P0 issues were found. The alpha RC is ready.
