# A8-prep Issue Triage

## Classification

| Severity | Criteria |
|----------|----------|
| P0 | Crashes, corrupted outputs, non-deterministic, broken core commands |
| P1 | Common flow broken, misleading failures, schema contract broken |
| P2 | Polish, wording, non-critical edge cases |
| P3 | Deferred nice-to-haves |

## Issues Found (Initial Sweep)

| ID | Severity | Source | Description | Status |
|----|----------|--------|-------------|--------|
| SWEEP-1 | P1 | showcase:auth | AIR-E005 false positive: `@nav` references `@protected:/` and `redirect` flagged as missing pages | Fixed |
| SWEEP-2 | P1 | showcase:dashboard | AIR-E008 false positive: `@auth(required)` without `/login` route flagged as error | Fixed |
| SWEEP-3 | P1 | replay:dashboard | Same as SWEEP-2 (dashboard.air via replay path) | Fixed |

## Fixes Applied

1. **E005 nav reference filter** (`src/validator/index.ts`): Skip references containing `@`, `/`, `:`, and known navigation keywords (`redirect`, `back`, `reload`, `replace`, `push`, `pop`).
2. **E008 downgrade to W008** (`src/validator/index.ts`): `@auth(required)` without a login route is now a warning (W008), not an error. External auth providers are a valid pattern.
3. **Test update** (`tests/diagnostics.test.ts`): Updated E008 test to expect W008 warning.

## Post-Fix Sweep Results

12/12 cases pass (7 showcase + 5 replay), 0 issues.

## Summary

- **P0 count**: 0
- **P1 count**: 3 (all fixed)
- **P2 count**: 0
- **P3 count**: 0
- **Verdict**: CLEAR — no outstanding issues, proceed with A8 rerun
