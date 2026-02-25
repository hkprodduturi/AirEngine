#!/usr/bin/env npx tsx
/**
 * A6b Foundation Gate Command
 *
 * Orchestrates 4 sequential checks that form the CI gate:
 *   1. Type check (tsc --noEmit)
 *   2. Test suite (vitest run)
 *   3. Eval harness (eval-local.ts)
 *   4. Schema sanity (parse + structural + live validation)
 *
 * Usage:  node --import tsx scripts/foundation-check.ts [--verbose] [--fail-fast]
 * Output: artifacts/foundation/foundation-check-report.json
 * Exit:   0 = all pass, 1 = any failure
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from '../src/parser/index.js';
import { diagnose } from '../src/validator/index.js';
import { buildResult, hashSource } from '../src/diagnostics.js';
import { runLoop, runLoopFromSource } from '../src/cli/loop.js';

// ---- Types ----

interface StepResult {
  name: string;
  command: string;
  status: 'pass' | 'fail' | 'skipped';
  exitCode: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  details?: Record<string, unknown>;
}

interface FoundationReport {
  timestamp: string;
  airengineVersion: string;
  nodeVersion: string;
  platform: string;
  steps: StepResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };
  verdict: 'pass' | 'fail';
}

// ---- CLI args ----

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const failFast = args.includes('--fail-fast');

function log(msg: string) {
  console.log(msg);
}

// ---- Step runner ----

function runShellStep(name: string, command: string): StepResult {
  const start = performance.now();
  log(`  RUN   ${name}`);
  log(`        $ ${command}`);

  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000, // 5 min timeout
    });

    const durationMs = Math.round(performance.now() - start);
    log(`  PASS  ${name} (${durationMs}ms)`);

    return {
      name,
      command,
      status: 'pass',
      exitCode: 0,
      durationMs,
      ...(verbose ? { stdout: stdout.slice(0, 10_000) } : {}),
    };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - start);
    const exitCode = err.status ?? 1;
    const stdout = err.stdout?.toString().slice(0, 10_000) ?? '';
    const stderr = err.stderr?.toString().slice(0, 10_000) ?? '';

    log(`  FAIL  ${name} (${durationMs}ms, exit ${exitCode})`);
    if (verbose && stderr) {
      for (const line of stderr.split('\n').slice(0, 20)) {
        log(`        ${line}`);
      }
    }

    return {
      name,
      command,
      status: 'fail',
      exitCode,
      durationMs,
      ...(verbose ? { stdout, stderr } : {}),
    };
  }
}

// Shared recursive JSON Schema validator
import { validateJsonSchema } from '../tests/schema-validator.js';

// ---- Schema sanity step ----

async function runSchemaSanity(): Promise<StepResult> {
  const start = performance.now();
  const name = 'schema-sanity';
  const command = '(inline schema validation)';
  const details: Record<string, unknown> = {};
  const failures: string[] = [];

  log(`  RUN   ${name}`);

  // 1. Parse schemas as valid JSON and check structural fields
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const schemaFile of ['docs/diagnostics.schema.json', 'docs/loop-result.schema.json']) {
    try {
      const raw = readFileSync(schemaFile, 'utf-8');
      const schema = JSON.parse(raw);
      if (!schema.$schema) failures.push(`${schemaFile}: missing $schema`);
      if (!schema.type) failures.push(`${schemaFile}: missing type`);
      if (!schema.properties && !schema.$defs) failures.push(`${schemaFile}: missing properties/$defs`);
      schemas[schemaFile] = schema;
      details[schemaFile] = 'valid';
    } catch (err: any) {
      failures.push(`${schemaFile}: ${err.message}`);
      details[schemaFile] = 'invalid';
    }
  }

  // 2. Live validation: generate DiagnosticResult from todo.air — full schema validation
  try {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const ast = parse(source);
    const diags = diagnose(ast);
    const result = buildResult(diags, hashSource(source));

    const diagSchema = schemas['docs/diagnostics.schema.json'];
    if (diagSchema) {
      const schemaErrors = validateJsonSchema(result, diagSchema, diagSchema);
      if (schemaErrors.length > 0) {
        for (const e of schemaErrors) failures.push(`DiagnosticResult: ${e}`);
        details['diagnostics_live'] = { status: 'invalid', errors: schemaErrors };
      } else {
        details['diagnostics_live'] = 'validated';
      }
    }
  } catch (err: any) {
    failures.push(`DiagnosticResult live validation: ${err.message}`);
    details['diagnostics_live'] = 'failed';
  }

  // 3. Live validation: generate LoopResult from todo.air via runLoop — full schema validation
  const tmpOut = join(tmpdir(), `foundation-loop-${Date.now()}`);
  try {
    mkdirSync(tmpOut, { recursive: true });

    const loopResult = await runLoop('examples/todo.air', tmpOut);

    // Build MCP-style response to validate against loop-result.schema.json
    const repairStage = loopResult.stages.find(s => s.name === 'repair');
    const success = !loopResult.stages.some(s => {
      if (s.name === 'validate' && repairStage?.status === 'pass') return false;
      return s.status === 'fail';
    });
    const response: Record<string, unknown> = {
      schema_version: '1.0',
      success,
      stages: loopResult.stages,
      diagnostics: loopResult.repairResult?.afterDiagnostics ?? loopResult.diagnostics,
      determinism: loopResult.determinismCheck,
    };

    const loopSchema = schemas['docs/loop-result.schema.json'];
    if (loopSchema) {
      const schemaErrors = validateJsonSchema(response, loopSchema, loopSchema);
      if (schemaErrors.length > 0) {
        for (const e of schemaErrors) failures.push(`LoopResult: ${e}`);
        details['loop_live'] = { status: 'invalid', errors: schemaErrors };
      } else {
        details['loop_live'] = 'validated';
      }
    }
  } catch (err: any) {
    failures.push(`LoopResult live validation: ${err.message}`);
    details['loop_live'] = 'failed';
  } finally {
    try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // 4. Live validation: multi-attempt loop with repair_attempts — exercises snake_case mapping
  const tmpOutRepair = join(tmpdir(), `foundation-loop-repair-${Date.now()}`);
  try {
    mkdirSync(tmpOutRepair, { recursive: true });

    // Repairable source (triggers E001/E002) with maxRepairAttempts=2 to produce repair_attempts
    const repairSource = '@state{x:int}';
    const repairResult = await runLoopFromSource(repairSource, tmpOutRepair, {
      maxRepairAttempts: 2,
      writeArtifacts: false,
    });

    // Build MCP-style response with snake_case repair_attempts mapping (same as server.ts)
    const repairStage2 = repairResult.stages.find(s => s.name === 'repair');
    const success2 = !repairResult.stages.some(s => {
      if (s.name === 'validate' && repairStage2?.status === 'pass') return false;
      return s.status === 'fail';
    });
    const repairResponse: Record<string, unknown> = {
      schema_version: '1.0',
      success: success2,
      stages: repairResult.stages,
      diagnostics: repairResult.repairResult?.afterDiagnostics ?? repairResult.diagnostics,
      determinism: repairResult.determinismCheck,
    };
    if (repairResult.repairAttempts) {
      repairResponse.repair_attempts = repairResult.repairAttempts.map(a => ({
        attempt: a.attemptNumber,
        errors_before: a.errorsBefore,
        errors_after: a.errorsAfter,
        source_hash: a.sourceHash,
        duration_ms: a.durationMs,
        ...(a.stopReason ? { stop_reason: a.stopReason } : {}),
      }));
    }

    const loopSchema2 = schemas['docs/loop-result.schema.json'];
    if (loopSchema2) {
      const schemaErrors = validateJsonSchema(repairResponse, loopSchema2, loopSchema2);
      if (schemaErrors.length > 0) {
        for (const e of schemaErrors) failures.push(`LoopResult (repair_attempts): ${e}`);
        details['loop_repair_attempts'] = { status: 'invalid', errors: schemaErrors };
      } else {
        details['loop_repair_attempts'] = 'validated';
      }
    }

    // Also verify repair_attempts was actually populated
    if (!repairResult.repairAttempts || repairResult.repairAttempts.length === 0) {
      failures.push('LoopResult (repair_attempts): expected non-empty repair_attempts for maxRepairAttempts=2');
      details['loop_repair_attempts_populated'] = false;
    } else {
      details['loop_repair_attempts_populated'] = true;
    }
  } catch (err: any) {
    failures.push(`LoopResult (repair_attempts) live validation: ${err.message}`);
    details['loop_repair_attempts'] = 'failed';
  } finally {
    try { rmSync(tmpOutRepair, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const durationMs = Math.round(performance.now() - start);
  const status = failures.length === 0 ? 'pass' : 'fail';

  log(`  ${status === 'pass' ? 'PASS' : 'FAIL'}  ${name} (${durationMs}ms)`);
  if (verbose && failures.length > 0) {
    for (const f of failures) log(`        ${f}`);
  }

  return {
    name,
    command,
    status,
    exitCode: status === 'pass' ? 0 : 1,
    durationMs,
    details: { ...details, failures },
  };
}

// ---- Main ----

async function main() {
  log('\n  AirEngine Foundation Gate (A6b)\n');

  const overallStart = performance.now();
  const steps: StepResult[] = [];
  let stopped = false;

  // Step 1: Type check
  const tscResult = runShellStep('type-check', 'npx tsc --noEmit');
  steps.push(tscResult);
  if (failFast && tscResult.status === 'fail') stopped = true;

  // Step 2: Test suite
  if (!stopped) {
    const testResult = runShellStep('test-suite', 'npx vitest run');
    steps.push(testResult);
    if (failFast && testResult.status === 'fail') stopped = true;
  } else {
    steps.push({ name: 'test-suite', command: 'npx vitest run', status: 'skipped', exitCode: -1, durationMs: 0 });
  }

  // Step 3: Eval harness
  if (!stopped) {
    const evalResult = runShellStep('eval-harness', 'node --import tsx scripts/eval-local.ts');
    steps.push(evalResult);
    if (failFast && evalResult.status === 'fail') stopped = true;
  } else {
    steps.push({ name: 'eval-harness', command: 'node --import tsx scripts/eval-local.ts', status: 'skipped', exitCode: -1, durationMs: 0 });
  }

  // Step 4: Schema sanity
  if (!stopped) {
    const schemaResult = await runSchemaSanity();
    steps.push(schemaResult);
  } else {
    steps.push({ name: 'schema-sanity', command: '(inline schema validation)', status: 'skipped', exitCode: -1, durationMs: 0 });
  }

  // ---- Report ----

  const totalDuration = Math.round(performance.now() - overallStart);
  const passed = steps.filter(s => s.status === 'pass').length;
  const failed = steps.filter(s => s.status === 'fail').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;

  const report: FoundationReport = {
    timestamp: new Date().toISOString(),
    airengineVersion: '0.2.0',
    nodeVersion: process.version,
    platform: process.platform,
    steps,
    summary: {
      total: steps.length,
      passed,
      failed,
      skipped,
      durationMs: totalDuration,
    },
    verdict: failed === 0 ? 'pass' : 'fail',
  };

  mkdirSync('artifacts/foundation', { recursive: true });
  writeFileSync('artifacts/foundation/foundation-check-report.json', JSON.stringify(report, null, 2));

  log('\n  -------- Summary --------');
  log(`  Steps:   ${steps.length}`);
  log(`  Passed:  ${passed}`);
  log(`  Failed:  ${failed}`);
  log(`  Skipped: ${skipped}`);
  log(`  Time:    ${totalDuration}ms`);
  log(`  Verdict: ${report.verdict.toUpperCase()}`);
  log(`  Report:  artifacts/foundation/foundation-check-report.json\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n  Fatal error: ${err.message}\n`);
  process.exit(1);
});
