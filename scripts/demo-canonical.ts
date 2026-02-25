#!/usr/bin/env npx tsx
/**
 * A5a Canonical Demo Automation
 *
 * Runs the fullstack-todo.air example through the full AirEngine pipeline
 * (validate → repair → transpile → smoke → determinism) and reports results.
 *
 * Usage:  node --import tsx scripts/demo-canonical.ts [--fixture path]
 * Output: artifacts/demo/canonical-demo-run.json
 * Exit:   0 = no failed stages, 1 = any stage failed
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runLoop } from '../src/cli/loop.js';

// ---- Types ----

interface StageStatus {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  details?: Record<string, unknown>;
}

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

// ---- CLI args ----

const args = process.argv.slice(2);
let fixture = 'examples/fullstack-todo.air';

const fixtureIdx = args.indexOf('--fixture');
if (fixtureIdx >= 0 && fixtureIdx + 1 < args.length) {
  fixture = args[fixtureIdx + 1];
}

function log(msg: string) {
  console.log(msg);
}

// ---- Main ----

async function main() {
  log('\n  AirEngine Canonical Demo (A5a)\n');
  log(`  Fixture: ${fixture}`);

  const start = performance.now();
  const tmpOut = join(tmpdir(), `demo-canonical-${Date.now()}`);
  mkdirSync(tmpOut, { recursive: true });

  try {
    const result = await runLoop(fixture, tmpOut);

    const totalDurationMs = Math.round(performance.now() - start);

    // Extract stage statuses
    function getStage(name: string): StageStatus {
      const stage = result.stages.find(s => s.name === name);
      return stage
        ? { name: stage.name, status: stage.status, durationMs: stage.durationMs, details: stage.details }
        : { name, status: 'skip', durationMs: 0, details: { reason: 'Stage not reached' } };
    }

    const pipeline = {
      validate: getStage('validate'),
      repair: getStage('repair'),
      transpile: getStage('transpile'),
      smoke: getStage('smoke'),
      determinism: getStage('determinism'),
    };

    // Success: no stage has status === 'fail'
    // Repair stage may be 'skip' on valid fixture — this is expected, not a failure.
    const allPassed = !result.stages.some(s => s.status === 'fail');

    const demoResult: DemoRunResult = {
      timestamp: new Date().toISOString(),
      fixture,
      pipeline,
      summary: {
        allPassed,
        totalDurationMs,
        outputDir: tmpOut,
        artifactDir: result.artifactDir,
      },
    };

    // Print stage summary
    log('');
    for (const stage of result.stages) {
      const icon = stage.status === 'pass' ? '  PASS' : stage.status === 'fail' ? '  FAIL' : '  SKIP';
      log(`  ${icon}  ${stage.name} (${stage.durationMs}ms)`);
    }
    log('');

    if (result.transpileResult) {
      log(`  Output:   ${result.transpileResult.files.length} files, ${result.transpileResult.stats.outputLines} lines`);
    }
    log(`  Deterministic: ${result.determinismCheck.deterministic ? 'yes' : 'NO'}`);
    log(`  Artifacts: ${result.artifactDir}/`);
    log('');
    log(`  Verdict: ${allPassed ? 'PASS' : 'FAIL'}`);
    log(`  Time:    ${totalDurationMs}ms`);

    // Write report
    mkdirSync('artifacts/demo', { recursive: true });
    writeFileSync('artifacts/demo/canonical-demo-run.json', JSON.stringify(demoResult, null, 2));
    log(`  Report:  artifacts/demo/canonical-demo-run.json\n`);

    // Cleanup temp dir
    try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }

    process.exit(allPassed ? 0 : 1);
  } catch (err: any) {
    log(`\n  Fatal error: ${err.message}`);
    try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
