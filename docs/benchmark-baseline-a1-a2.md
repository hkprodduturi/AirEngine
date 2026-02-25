# Benchmark Baseline — Post A1+A2

## Summary

Offline benchmark of all 7 core examples after A1 (diagnostics) and A2 (T1 transpiler completion).

**Budget pass/fail** (the stable claims — not sensitive to run-to-run timing jitter):

| Budget | Threshold | Result |
|--------|-----------|--------|
| Single file | < 200ms | PASS (all 7) |
| Cumulative (7 files) | < 500ms | PASS |
| Hash stability | All identical across runs | PASS |

Environment: AirEngine 0.2.0, Node v20.17.0, darwin arm64.

## Per-File Results (stable metrics)

Timings are from a sample run and vary by machine/load. The key invariant is that every file stays well under the 200ms budget. See `artifacts/benchmarks/offline-baseline.json` for the exact snapshot.

| File | Source Lines | Output Files | Output Lines | Compression | Under 200ms | Hash Stable |
|------|-------------|-------------|-------------|-------------|-------------|-------------|
| todo.air | 12 | 9 | 395 | 32.9x | YES | YES |
| expense-tracker.air | 33 | 9 | 450 | 13.6x | YES | YES |
| auth.air | 25 | 21 | 967 | 38.7x | YES | YES |
| dashboard.air | 38 | 26 | 1,343 | 35.3x | YES | YES |
| landing.air | 32 | 9 | 429 | 13.4x | YES | YES |
| fullstack-todo.air | 21 | 25 | 1,135 | 54.0x | YES | YES |
| projectflow.air | 302 | 44 | 3,177 | 10.5x | YES | YES |

## Aggregate (stable metrics)

| Metric | Value |
|--------|-------|
| Total source lines | 463 |
| Total output lines | 7,896 |
| Average compression | 28.3x |
| Cumulative under 500ms | YES |
| All hash-stable | YES |

## Observations

1. **Compression ratio range**: 10.5x (projectflow) to 54.0x (fullstack-todo)
   - Higher compression for apps with standard patterns (CRUD, auth flows)
   - Lower compression for large multi-model apps (more unique logic per model)

2. **Determinism**: All 7 examples produce bit-identical output across two transpile runs
   - Excludes `_airengine_manifest.json` (contains timestamp)

3. **Performance headroom**: Observed cumulative totals are typically 30-60ms, well under the 500ms budget. Individual files typically complete in 1-30ms, well under the 200ms budget. Exact timings vary by machine, JIT warmup order, and system load.

## Artifact

Full structured data with exact per-run timings: `artifacts/benchmarks/offline-baseline.json`

## Command

```
npx tsx scripts/benchmark-baseline.ts
```
