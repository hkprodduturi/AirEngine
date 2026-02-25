#!/usr/bin/env npx tsx
/**
 * A6a Local Eval / Regression Harness
 *
 * Runs foundation checks for AI-first pipeline stability:
 *   1. Diagnostics contract — schema validation on sample outputs
 *   2. Diagnostics determinism — same input -> byte-identical JSON
 *   3. Corpus smoke — parse/validate/transpile on examples + fixtures
 *   4. Transpile determinism — hash stability on corpus subset
 *   5. Loop MVP smoke — valid + invalid fixture through agent loop
 *   6. Benchmark baseline — runs and produces artifact JSON
 *
 * Usage:  npx tsx scripts/eval-local.ts [--verbose]
 * Output: artifacts/eval/local-eval-report.json
 * Exit:   0 = all pass, 1 = one or more failures
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { parse } from '../src/parser/index.js';
import { diagnose } from '../src/validator/index.js';
import { transpile } from '../src/transpiler/index.js';
import { buildResult, hashSource } from '../src/diagnostics.js';
import type { DiagnosticResult } from '../src/diagnostics.js';
import { runLoop } from '../src/cli/loop.js';

// ---- Types ----

interface CheckResult {
  name: string;
  category: 'diagnostics' | 'corpus' | 'determinism' | 'loop' | 'benchmark';
  status: 'pass' | 'fail';
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

interface EvalReport {
  timestamp: string;
  airengineVersion: string;
  nodeVersion: string;
  platform: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    durationMs: number;
  };
  commands: string[];
}

// ---- Helpers ----

const VERBOSE = process.argv.includes('--verbose');

function log(msg: string) {
  console.log(msg);
}

function logVerbose(msg: string) {
  if (VERBOSE) console.log(msg);
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function loadSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync('docs/diagnostics.schema.json', 'utf-8'));
}

// Minimal JSON Schema validator for our DiagnosticResult schema
// Validates required fields, types, enums, and patterns — no external deps
function validateAgainstSchema(obj: unknown, schema: Record<string, unknown>, path = '$'): string[] {
  const errors: string[] = [];

  if (schema['type'] === 'object' && typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>;

    // Check required fields
    const required = (schema['required'] as string[]) || [];
    for (const field of required) {
      if (!(field in record)) {
        errors.push(`${path}: missing required field '${field}'`);
      }
    }

    // Check properties
    const properties = (schema['properties'] as Record<string, Record<string, unknown>>) || {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in record) {
        errors.push(...validateAgainstSchema(record[key], propSchema, `${path}.${key}`));
      }
    }

    // Check additionalProperties: false
    if (schema['additionalProperties'] === false) {
      const allowed = new Set(Object.keys(properties));
      for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: unexpected property '${key}'`);
        }
      }
    }
  } else if (schema['type'] === 'array' && Array.isArray(obj)) {
    const items = schema['items'] as Record<string, unknown>;
    if (items) {
      // Resolve $ref
      const resolved = items['$ref'] ? resolveRef(items['$ref'] as string) : items;
      for (let i = 0; i < obj.length; i++) {
        errors.push(...validateAgainstSchema(obj[i], resolved, `${path}[${i}]`));
      }
    }
  } else if (schema['type'] === 'string') {
    if (typeof obj !== 'string') {
      errors.push(`${path}: expected string, got ${typeof obj}`);
    } else {
      if (schema['enum'] && !(schema['enum'] as string[]).includes(obj)) {
        errors.push(`${path}: value '${obj}' not in enum [${(schema['enum'] as string[]).join(', ')}]`);
      }
      if (schema['const'] && obj !== schema['const']) {
        errors.push(`${path}: expected const '${schema['const']}', got '${obj}'`);
      }
      if (schema['pattern']) {
        const re = new RegExp(schema['pattern'] as string);
        if (!re.test(obj)) {
          errors.push(`${path}: value '${obj}' doesn't match pattern ${schema['pattern']}`);
        }
      }
    }
  } else if (schema['type'] === 'boolean') {
    if (typeof obj !== 'boolean') {
      errors.push(`${path}: expected boolean, got ${typeof obj}`);
    }
  } else if (schema['type'] === 'integer') {
    if (typeof obj !== 'number' || !Number.isInteger(obj)) {
      errors.push(`${path}: expected integer, got ${typeof obj} (${obj})`);
    }
    if (typeof schema['minimum'] === 'number' && (obj as number) < schema['minimum']) {
      errors.push(`${path}: value ${obj} below minimum ${schema['minimum']}`);
    }
  }

  return errors;
}

// Cache for the parsed schema
let _schemaCache: Record<string, unknown> | null = null;

function getSchema(): Record<string, unknown> {
  if (!_schemaCache) _schemaCache = loadSchema();
  return _schemaCache;
}

function resolveRef(ref: string): Record<string, unknown> {
  // Handle #/$defs/Diagnostic style refs
  const schema = getSchema();
  const parts = ref.replace('#/', '').split('/');
  let current: unknown = schema;
  for (const part of parts) {
    current = (current as Record<string, unknown>)[part];
  }
  return current as Record<string, unknown>;
}

// ---- Check: Diagnostics Schema Validation ----

function checkDiagnosticsSchema(): CheckResult {
  const start = performance.now();
  const schema = getSchema();

  // Generate DiagnosticResults from a few different inputs
  const testCases = [
    { label: 'valid-minimal', file: 'tests/fixtures/valid-minimal.air', expectValid: true },
    { label: 'todo-example', file: 'examples/todo.air', expectValid: true },
    { label: 'fullstack-todo', file: 'examples/fullstack-todo.air', expectValid: true },
  ];

  const allErrors: string[] = [];

  for (const tc of testCases) {
    try {
      const source = readFileSync(tc.file, 'utf-8');
      const ast = parse(source);
      const diags = diagnose(ast);
      const result = buildResult(diags, hashSource(source));

      // Validate against schema
      const errors = validateAgainstSchema(result, schema);
      if (errors.length > 0) {
        allErrors.push(`${tc.label}: ${errors.join('; ')}`);
      }

      // Check valid flag consistency
      const hasErrors = result.diagnostics.some(d => d.severity === 'error');
      if (result.valid === hasErrors && result.diagnostics.length > 0) {
        allErrors.push(`${tc.label}: valid flag inconsistent with diagnostics`);
      }
    } catch (err: any) {
      allErrors.push(`${tc.label}: ${err.message}`);
    }
  }

  // Also validate error fixture diagnostics against schema
  const errorFixtures = [
    'tests/fixtures/validation-error-no-ui.air',
    'tests/fixtures/validation-error-unknown-model.air',
  ];

  for (const fixture of errorFixtures) {
    try {
      const source = readFileSync(fixture, 'utf-8');
      const ast = parse(source);
      const diags = diagnose(ast);
      const result = buildResult(diags, hashSource(source));

      const errors = validateAgainstSchema(result, schema);
      if (errors.length > 0) {
        allErrors.push(`${basename(fixture)}: ${errors.join('; ')}`);
      }

      if (result.valid) {
        allErrors.push(`${basename(fixture)}: expected invalid but got valid`);
      }
    } catch (err: any) {
      // Parse errors are expected for some fixtures — still validate the result
      const { wrapParseError } = require('../src/diagnostics.js');
      const diag = wrapParseError(err);
      const result = buildResult([diag], hashSource(readFileSync(fixture, 'utf-8')));
      const errors = validateAgainstSchema(result, schema);
      if (errors.length > 0) {
        allErrors.push(`${basename(fixture)} (parse error): ${errors.join('; ')}`);
      }
    }
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    name: 'diagnostics-schema-validation',
    category: 'diagnostics',
    status: allErrors.length === 0 ? 'pass' : 'fail',
    durationMs,
    details: {
      testCases: testCases.length + errorFixtures.length,
      errors: allErrors,
    },
    ...(allErrors.length > 0 && { error: allErrors.join('\n') }),
  };
}

// ---- Check: Diagnostics Determinism ----

function checkDiagnosticsDeterminism(): CheckResult {
  const start = performance.now();
  const files = [
    'tests/fixtures/valid-minimal.air',
    'examples/todo.air',
    'examples/auth.air',
    'tests/fixtures/validation-error-no-ui.air',
    'tests/fixtures/lint-warning-no-persist.air',
  ];

  const failures: string[] = [];

  for (const file of files) {
    try {
      const source = readFileSync(file, 'utf-8');
      const srcHash = hashSource(source);

      // Run twice
      const ast1 = parse(source);
      const diags1 = diagnose(ast1);
      const result1 = buildResult(diags1, srcHash);
      const json1 = JSON.stringify(result1);

      const ast2 = parse(source);
      const diags2 = diagnose(ast2);
      const result2 = buildResult(diags2, srcHash);
      const json2 = JSON.stringify(result2);

      if (json1 !== json2) {
        failures.push(`${basename(file)}: non-deterministic diagnostics output`);
        logVerbose(`    DIFF in ${basename(file)}:`);
        logVerbose(`      Run 1: ${json1.slice(0, 200)}...`);
        logVerbose(`      Run 2: ${json2.slice(0, 200)}...`);
      }
    } catch {
      // Parse error fixtures: test that parse errors are deterministic
      try {
        const source = readFileSync(file, 'utf-8');
        const srcHash = hashSource(source);

        let err1: any, err2: any;
        try { parse(source); } catch (e) { err1 = e; }
        try { parse(source); } catch (e) { err2 = e; }

        if (err1 && err2) {
          const { wrapParseError } = require('../src/diagnostics.js');
          const r1 = JSON.stringify(buildResult([wrapParseError(err1)], srcHash));
          const r2 = JSON.stringify(buildResult([wrapParseError(err2)], srcHash));
          if (r1 !== r2) {
            failures.push(`${basename(file)}: non-deterministic parse error diagnostics`);
          }
        }
      } catch (innerErr: any) {
        failures.push(`${basename(file)}: ${innerErr.message}`);
      }
    }
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    name: 'diagnostics-determinism',
    category: 'diagnostics',
    status: failures.length === 0 ? 'pass' : 'fail',
    durationMs,
    details: { filesChecked: files.length, failures },
    ...(failures.length > 0 && { error: failures.join('\n') }),
  };
}

// ---- Check: Corpus Parse/Validate/Transpile Smoke ----

function checkCorpusSmoke(): CheckResult {
  const start = performance.now();
  const failures: string[] = [];
  const stats = { parsed: 0, validated: 0, transpiled: 0 };

  // Core examples (must all parse + transpile)
  const coreExamples = [
    'examples/todo.air',
    'examples/expense-tracker.air',
    'examples/auth.air',
    'examples/dashboard.air',
    'examples/landing.air',
    'examples/fullstack-todo.air',
    'examples/projectflow.air',
  ];

  // Base templates (subset — first 5 for runtime)
  const baseTemplates = readdirSync('examples')
    .filter(f => f.startsWith('base-') && f.endsWith('.air'))
    .slice(0, 5)
    .map(f => join('examples', f));

  // Valid fixtures
  const validFixtures = ['tests/fixtures/valid-minimal.air'];

  const allValid = [...coreExamples, ...baseTemplates, ...validFixtures];

  for (const file of allValid) {
    try {
      const source = readFileSync(file, 'utf-8');
      const ast = parse(source);
      stats.parsed++;

      const diags = diagnose(ast);
      stats.validated++;

      const sourceLines = source.split('\n').length;
      const result = transpile(ast, { sourceLines });
      stats.transpiled++;

      if (result.files.length === 0) {
        failures.push(`${basename(file)}: transpile produced 0 files`);
      }
    } catch (err: any) {
      failures.push(`${basename(file)}: ${err.message}`);
    }
  }

  // Invalid fixtures (must parse but produce errors, or throw parse errors)
  const invalidFixtures = [
    'tests/fixtures/validation-error-no-ui.air',
    'tests/fixtures/validation-error-unknown-model.air',
    'tests/fixtures/lint-warning-db-no-api.air',
    'tests/fixtures/lint-warning-no-persist.air',
    'tests/fixtures/lint-warning-no-pk.air',
  ];

  for (const file of invalidFixtures) {
    try {
      const source = readFileSync(file, 'utf-8');
      const ast = parse(source);
      const diags = diagnose(ast);
      const result = buildResult(diags, hashSource(source));

      // These should have at least a warning or error
      if (result.diagnostics.length === 0) {
        failures.push(`${basename(file)}: expected diagnostics but got none`);
      }
    } catch {
      // Parse error is acceptable for invalid fixtures
    }
  }

  // Parse-error fixtures (must throw parse errors)
  const parseErrorFixtures = [
    'tests/fixtures/parse-error-missing-brace.air',
    'tests/fixtures/parse-error-unknown-block.air',
    'tests/fixtures/parse-error-unterminated-string.air',
  ];

  for (const file of parseErrorFixtures) {
    try {
      const source = readFileSync(file, 'utf-8');
      parse(source);
      failures.push(`${basename(file)}: expected parse error but parsed successfully`);
    } catch {
      // Expected
    }
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    name: 'corpus-smoke',
    category: 'corpus',
    status: failures.length === 0 ? 'pass' : 'fail',
    durationMs,
    details: {
      validFiles: allValid.length,
      invalidFiles: invalidFixtures.length,
      parseErrorFiles: parseErrorFixtures.length,
      ...stats,
      failures,
    },
    ...(failures.length > 0 && { error: failures.join('\n') }),
  };
}

// ---- Check: Transpile Determinism / Hash Stability ----

function checkTranspileDeterminism(): CheckResult {
  const start = performance.now();
  const failures: string[] = [];

  const files = [
    'examples/todo.air',
    'examples/auth.air',
    'examples/fullstack-todo.air',
    'examples/projectflow.air',
    'tests/fixtures/valid-minimal.air',
  ];

  for (const file of files) {
    try {
      const source = readFileSync(file, 'utf-8');
      const ast = parse(source);
      const sourceLines = source.split('\n').length;

      const result1 = transpile(ast, { sourceLines });
      const result2 = transpile(ast, { sourceLines });

      const hashes1 = new Map(result1.files.map(f => [f.path, hashContent(f.content)]));
      const hashes2 = new Map(result2.files.map(f => [f.path, hashContent(f.content)]));

      for (const [path, hash] of hashes1) {
        if (path === '_airengine_manifest.json') continue;
        if (hashes2.get(path) !== hash) {
          failures.push(`${basename(file)}: hash mismatch for ${path}`);
        }
      }

      // Check file count matches
      const nonManifest1 = result1.files.filter(f => f.path !== '_airengine_manifest.json').length;
      const nonManifest2 = result2.files.filter(f => f.path !== '_airengine_manifest.json').length;
      if (nonManifest1 !== nonManifest2) {
        failures.push(`${basename(file)}: file count mismatch (${nonManifest1} vs ${nonManifest2})`);
      }
    } catch (err: any) {
      failures.push(`${basename(file)}: ${err.message}`);
    }
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    name: 'transpile-determinism',
    category: 'determinism',
    status: failures.length === 0 ? 'pass' : 'fail',
    durationMs,
    details: { filesChecked: files.length, failures },
    ...(failures.length > 0 && { error: failures.join('\n') }),
  };
}

// ---- Check: Loop MVP Smoke ----

async function checkLoopSmoke(): Promise<CheckResult> {
  const start = performance.now();
  const failures: string[] = [];
  const loopDetails: Record<string, unknown> = {};

  // Valid example: should complete loop successfully
  const validFile = 'examples/todo.air';
  const validOutDir = '.eval-tmp/loop-valid';

  try {
    mkdirSync(validOutDir, { recursive: true });
    const result = await runLoop(validFile, validOutDir);

    const passed = result.stages.every(s => s.status !== 'fail');
    loopDetails['valid'] = {
      file: validFile,
      stages: result.stages.map(s => ({ name: s.name, status: s.status })),
      deterministic: result.determinismCheck.deterministic,
    };

    if (!passed) {
      const failedStages = result.stages.filter(s => s.status === 'fail').map(s => s.name);
      failures.push(`Valid loop failed stages: ${failedStages.join(', ')}`);
    }

    if (!result.determinismCheck.deterministic) {
      failures.push('Valid loop: determinism check failed');
    }
  } catch (err: any) {
    failures.push(`Valid loop error: ${err.message}`);
  }

  // Invalid example: should fail at validate stage
  const invalidFile = 'tests/fixtures/parse-error-missing-brace.air';
  const invalidOutDir = '.eval-tmp/loop-invalid';

  try {
    mkdirSync(invalidOutDir, { recursive: true });
    const result = await runLoop(invalidFile, invalidOutDir);

    loopDetails['invalid'] = {
      file: invalidFile,
      stages: result.stages.map(s => ({ name: s.name, status: s.status })),
    };

    // Validate stage should fail (parse error)
    const validateStage = result.stages.find(s => s.name === 'validate');
    if (!validateStage || validateStage.status !== 'fail') {
      failures.push('Invalid loop: expected validate to fail');
    }

    // Should not have transpile result
    if (result.transpileResult) {
      failures.push('Invalid loop: should not produce transpile output');
    }

    // Diagnostics should report errors
    if (result.diagnostics.valid) {
      failures.push('Invalid loop: diagnostics should be invalid');
    }
  } catch (err: any) {
    failures.push(`Invalid loop error: ${err.message}`);
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    name: 'loop-mvp-smoke',
    category: 'loop',
    status: failures.length === 0 ? 'pass' : 'fail',
    durationMs,
    details: { ...loopDetails, failures },
    ...(failures.length > 0 && { error: failures.join('\n') }),
  };
}

// ---- Check: Benchmark Baseline ----

function checkBenchmarkBaseline(): CheckResult {
  const start = performance.now();
  const failures: string[] = [];

  const coreExamples = [
    'examples/todo.air',
    'examples/expense-tracker.air',
    'examples/auth.air',
    'examples/dashboard.air',
    'examples/landing.air',
    'examples/fullstack-todo.air',
    'examples/projectflow.air',
  ];

  const benchmarks: Array<{ file: string; totalMs: number; hashStable: boolean }> = [];

  for (const file of coreExamples) {
    try {
      const source = readFileSync(file, 'utf-8');
      const sourceLines = source.split('\n').length;

      const t0 = performance.now();
      const ast = parse(source);
      const diags = diagnose(ast);
      buildResult(diags, hashSource(source));
      const result = transpile(ast, { sourceLines });
      const totalMs = performance.now() - t0;

      // Hash stability check
      const result2 = transpile(ast, { sourceLines });
      const hashes1 = new Map(result.files.map(f => [f.path, hashContent(f.content)]));
      const hashes2 = new Map(result2.files.map(f => [f.path, hashContent(f.content)]));
      let hashStable = true;
      for (const [path, hash] of hashes1) {
        if (path === '_airengine_manifest.json') continue;
        if (hashes2.get(path) !== hash) { hashStable = false; break; }
      }

      benchmarks.push({ file: basename(file), totalMs: Math.round(totalMs * 100) / 100, hashStable });

      if (totalMs > 200) {
        failures.push(`${basename(file)}: ${totalMs.toFixed(1)}ms exceeds 200ms ceiling`);
      }
      if (!hashStable) {
        failures.push(`${basename(file)}: hash unstable`);
      }
    } catch (err: any) {
      failures.push(`${basename(file)}: ${err.message}`);
    }
  }

  const totalMs = benchmarks.reduce((s, b) => s + b.totalMs, 0);
  if (totalMs > 500) {
    failures.push(`Cumulative ${totalMs.toFixed(1)}ms exceeds 500ms ceiling`);
  }

  // Write benchmark artifact
  const artifactPath = 'artifacts/eval/benchmark-baseline.json';
  mkdirSync('artifacts/eval', { recursive: true });
  const artifact = {
    timestamp: new Date().toISOString(),
    airengineVersion: '0.2.0',
    nodeVersion: process.version,
    platform: process.platform,
    benchmarks,
    aggregate: {
      totalMs: Math.round(totalMs * 100) / 100,
      maxMs: Math.round(Math.max(...benchmarks.map(b => b.totalMs)) * 100) / 100,
      allUnder200ms: benchmarks.every(b => b.totalMs < 200),
      cumulativeUnder500ms: totalMs < 500,
      allHashStable: benchmarks.every(b => b.hashStable),
    },
  };
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

  const durationMs = Math.round(performance.now() - start);

  return {
    name: 'benchmark-baseline',
    category: 'benchmark',
    status: failures.length === 0 ? 'pass' : 'fail',
    durationMs,
    details: {
      examples: benchmarks.length,
      totalMs: Math.round(totalMs * 100) / 100,
      allUnder200ms: benchmarks.every(b => b.totalMs < 200),
      cumulativeUnder500ms: totalMs < 500,
      allHashStable: benchmarks.every(b => b.hashStable),
      artifactPath,
      failures,
    },
    ...(failures.length > 0 && { error: failures.join('\n') }),
  };
}

// ---- Main Runner ----

async function main() {
  const overallStart = performance.now();

  log('\n  AirEngine Local Eval Harness (A6a)\n');
  log('  Running foundation checks...\n');

  const checks: CheckResult[] = [];
  const commands = [
    'npx tsx scripts/eval-local.ts',
  ];

  // 1. Diagnostics Schema Validation
  log('  [1/6] Diagnostics schema validation...');
  const schemaCheck = checkDiagnosticsSchema();
  checks.push(schemaCheck);
  log(`        ${schemaCheck.status === 'pass' ? 'PASS' : 'FAIL'}  (${schemaCheck.durationMs}ms)`);

  // 2. Diagnostics Determinism
  log('  [2/6] Diagnostics determinism...');
  const deterCheck = checkDiagnosticsDeterminism();
  checks.push(deterCheck);
  log(`        ${deterCheck.status === 'pass' ? 'PASS' : 'FAIL'}  (${deterCheck.durationMs}ms)`);

  // 3. Corpus Smoke
  log('  [3/6] Corpus parse/validate/transpile smoke...');
  const corpusCheck = checkCorpusSmoke();
  checks.push(corpusCheck);
  log(`        ${corpusCheck.status === 'pass' ? 'PASS' : 'FAIL'}  (${corpusCheck.durationMs}ms)`);

  // 4. Transpile Determinism
  log('  [4/6] Transpile determinism / hash stability...');
  const hashCheck = checkTranspileDeterminism();
  checks.push(hashCheck);
  log(`        ${hashCheck.status === 'pass' ? 'PASS' : 'FAIL'}  (${hashCheck.durationMs}ms)`);

  // 5. Loop MVP Smoke
  log('  [5/6] Loop MVP smoke (valid + invalid)...');
  const loopCheck = await checkLoopSmoke();
  checks.push(loopCheck);
  log(`        ${loopCheck.status === 'pass' ? 'PASS' : 'FAIL'}  (${loopCheck.durationMs}ms)`);

  // 6. Benchmark Baseline
  log('  [6/6] Benchmark baseline...');
  const benchCheck = checkBenchmarkBaseline();
  checks.push(benchCheck);
  log(`        ${benchCheck.status === 'pass' ? 'PASS' : 'FAIL'}  (${benchCheck.durationMs}ms)`);

  // ---- Summary ----

  const totalDuration = Math.round(performance.now() - overallStart);
  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    airengineVersion: '0.2.0',
    nodeVersion: process.version,
    platform: process.platform,
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      durationMs: totalDuration,
    },
    commands,
  };

  // Write report
  mkdirSync('artifacts/eval', { recursive: true });
  writeFileSync('artifacts/eval/local-eval-report.json', JSON.stringify(report, null, 2));

  log('\n  -------- Summary --------');
  log(`  Total:   ${checks.length} checks`);
  log(`  Passed:  ${passed}`);
  log(`  Failed:  ${failed}`);
  log(`  Time:    ${totalDuration}ms`);
  log(`  Report:  artifacts/eval/local-eval-report.json`);

  if (failed > 0) {
    log('\n  Failed checks:');
    for (const c of checks.filter(c => c.status === 'fail')) {
      log(`    FAIL  ${c.name}`);
      if (c.error) {
        for (const line of c.error.split('\n')) {
          log(`          ${line}`);
        }
      }
    }
  }

  log('');

  // Cleanup temp dirs
  try {
    const { rmSync } = await import('fs');
    rmSync('.eval-tmp', { recursive: true, force: true });
  } catch { /* ignore */ }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n  Fatal error: ${err.message}\n`);
  process.exit(1);
});
