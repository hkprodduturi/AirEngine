# Canonical Demo Runbook (A5a)

## Purpose

Automated demo that runs `fullstack-todo.air` through the full AirEngine pipeline.
Verifies that the most complex example fixture produces a clean pass on all stages.

## Usage

```bash
# Default: run fullstack-todo.air
node --import tsx scripts/demo-canonical.ts

# Custom fixture
node --import tsx scripts/demo-canonical.ts --fixture examples/dashboard.air

# npm script
npm run demo-canonical
```

## What It Does

1. Runs `runLoop('examples/fullstack-todo.air', tmpDir)` through all 5 stages
2. Captures per-stage status and timing
3. Checks that no stage has `status === 'fail'`
4. Reports transpile stats and determinism flag

## Success Criteria

- No stage has `status === 'fail'`
- Repair stage may be `skip` on valid fixtures (expected, not a failure)
- Determinism check passes

## Output

Report: `artifacts/demo/canonical-demo-run.json`

```typescript
interface DemoRunResult {
  timestamp: string;
  fixture: string;
  pipeline: {
    validate: StageStatus;
    repair: StageStatus;
    transpile: StageStatus;
    smoke: StageStatus;
    determinism: StageStatus;
  };
  summary: {
    allPassed: boolean;
    totalDurationMs: number;
    outputDir: string;
    artifactDir: string;
  };
}
```

## Exit Codes

- `0` — no failed stages
- `1` — any stage failed

## Temp Directory

Uses OS `tmpdir()` for generated output (cleaned up after run).
