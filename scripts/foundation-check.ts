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
import { runLoop } from '../src/cli/loop.js';

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

// ---- Mini JSON Schema Validator ----

/**
 * Recursive JSON Schema validator (subset: type, required, properties, enum,
 * const, pattern, minimum, additionalProperties, items, oneOf, $ref, $defs).
 * Returns an array of error strings; empty = valid.
 */
function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  rootSchema: Record<string, unknown>,
  path: string = '$',
): string[] {
  const errors: string[] = [];

  // Resolve $ref
  if (schema.$ref) {
    const refPath = (schema.$ref as string).replace('#/$defs/', '');
    const defs = (rootSchema.$defs ?? {}) as Record<string, Record<string, unknown>>;
    const resolved = defs[refPath];
    if (!resolved) {
      errors.push(`${path}: unresolvable $ref "${schema.$ref}"`);
      return errors;
    }
    return validateJsonSchema(value, resolved, rootSchema, path);
  }

  // oneOf
  if (schema.oneOf) {
    const branches = schema.oneOf as Record<string, unknown>[];
    const branchValid = branches.some(
      branch => validateJsonSchema(value, branch, rootSchema, path).length === 0,
    );
    if (!branchValid) {
      errors.push(`${path}: value does not match any oneOf branch`);
    }
    return errors;
  }

  // null check
  if (value === null || value === undefined) {
    if (schema.type === 'null') return errors;
    errors.push(`${path}: expected type "${schema.type}" but got null/undefined`);
    return errors;
  }

  // type check
  if (schema.type) {
    const sType = schema.type as string;
    let typeOk = false;
    if (sType === 'object') typeOk = typeof value === 'object' && !Array.isArray(value);
    else if (sType === 'array') typeOk = Array.isArray(value);
    else if (sType === 'string') typeOk = typeof value === 'string';
    else if (sType === 'number') typeOk = typeof value === 'number';
    else if (sType === 'integer') typeOk = typeof value === 'number' && Number.isInteger(value);
    else if (sType === 'boolean') typeOk = typeof value === 'boolean';
    else if (sType === 'null') typeOk = value === null;
    if (!typeOk) {
      errors.push(`${path}: expected type "${sType}" but got ${typeof value}${Array.isArray(value) ? '(array)' : ''}`);
      return errors;
    }
  }

  // const
  if ('const' in schema) {
    if (value !== schema.const) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)} but got ${JSON.stringify(value)}`);
    }
  }

  // enum
  if (schema.enum) {
    if (!(schema.enum as unknown[]).includes(value)) {
      errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    }
  }

  // pattern (strings)
  if (schema.pattern && typeof value === 'string') {
    if (!new RegExp(schema.pattern as string).test(value)) {
      errors.push(`${path}: "${value}" does not match pattern ${schema.pattern}`);
    }
  }

  // minimum (numbers)
  if (typeof schema.minimum === 'number' && typeof value === 'number') {
    if (value < (schema.minimum as number)) {
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    }
  }

  // object: required + properties + additionalProperties
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const field of schema.required as string[]) {
        if (!(field in obj)) {
          errors.push(`${path}: missing required field "${field}"`);
        }
      }
    }

    if (schema.properties) {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          errors.push(...validateJsonSchema(obj[key], propSchema, rootSchema, `${path}.${key}`));
        }
      }
    }

    // additionalProperties: false — check for unexpected keys
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties as object));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: unexpected field "${key}" (additionalProperties=false)`);
        }
      }
    }

    // additionalProperties as schema (for Maps like outputHashes)
    if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
      const valSchema = schema.additionalProperties as Record<string, unknown>;
      for (const [key, val] of Object.entries(obj)) {
        if (schema.properties && key in (schema.properties as object)) continue;
        errors.push(...validateJsonSchema(val, valSchema, rootSchema, `${path}.${key}`));
      }
    }
  }

  // array: items
  if (Array.isArray(value) && schema.items) {
    const itemSchema = schema.items as Record<string, unknown>;
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateJsonSchema(value[i], itemSchema, rootSchema, `${path}[${i}]`));
    }
  }

  return errors;
}

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
