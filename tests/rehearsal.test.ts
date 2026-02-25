/**
 * A8 Alpha RC Rehearsal Tests
 *
 * Tests for release-alpha-rehearsal.ts — mode resolution, aggregation,
 * verdict computation, baseline validation, report building, and schema
 * conformance. All network-free.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  resolveRehearsalMode,
  aggregateSteps,
  computeVerdict,
  validateBaseline,
  buildRehearsalReport,
} from '../scripts/release-alpha-rehearsal.js';
import type {
  RehearsalMode,
  RehearsalReport,
  BaselineValidation,
  StageSummaries,
} from '../scripts/release-alpha-rehearsal.js';
import {
  runStep,
  skipStep,
  summarizeSteps,
} from '../scripts/quality-gate.js';
import type { GateStep, GateSummary } from '../scripts/quality-gate.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Helpers ----

const TMP_DIR = join(__dirname, '..', 'artifacts', 'test-tmp-rehearsal');
const SCHEMA_PATH = join(__dirname, '..', 'docs', 'alpha-rc-rehearsal-result.schema.json');
const BASELINE_PATH = join(__dirname, '..', 'benchmarks', 'online-eval-baseline-alpha.json');

function makePassStep(name: string): GateStep {
  return { name, command: `echo ${name}`, status: 'pass', exit_code: 0, duration_ms: 10 };
}

function makeFailStep(name: string): GateStep {
  return { name, command: `echo ${name}`, status: 'fail', exit_code: 1, duration_ms: 10 };
}

function makeSkipStep(name: string): GateStep {
  return skipStep(name, '', 'test skip reason');
}

function fullPassSteps(): GateStep[] {
  return [
    makePassStep('doctor'),
    makePassStep('offline-gates'),
    makePassStep('canonical-demo'),
    makePassStep('online-eval'),
    makePassStep('online-compare'),
    makePassStep('baseline-freeze'),
  ];
}

function offlineSteps(): GateStep[] {
  return [
    makePassStep('doctor'),
    makePassStep('offline-gates'),
    makePassStep('canonical-demo'),
    makeSkipStep('online-eval'),
    makeSkipStep('online-compare'),
    makeSkipStep('baseline-freeze'),
  ];
}

function makeValidBaseline(): Record<string, unknown> {
  return {
    schema_version: '1.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    run_metadata: { airengine_version: '0.2.0', node_version: 'v22.0.0', platform: 'darwin' },
    config: { generator_model: 'test', repair_mode: 'deterministic', max_repair_attempts: 1, timeout_ms: 30000, provider_retries: 2 },
    corpus: { path: 'test', total_entries: 1, limit_applied: null, corpus_id: 'test' },
    cases: [],
    metrics: {
      total_cases: 1, completed_cases: 1, success_count: 1,
      prompt_to_air_success_rate: 1.0, prompt_to_running_app_success_rate: 1.0,
      timing: { avg_total_ms: 100, p50_total_ms: 100, p95_total_ms: 100, avg_generation_ms: 50, avg_loop_ms: 50 },
      tokens: { total_input: 100, total_output: 50, avg_input: 100, avg_output: 50 },
      retries: { avg_generation_attempts: 1, avg_repair_attempts: 0 },
      failure_breakdown: {},
    },
    artifact_dir: 'test',
    _provenance: { frozen_at: '2026-01-01T00:00:00.000Z', source_report: 'test' },
  };
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

// ---- resolveRehearsalMode ----

describe('resolveRehearsalMode', () => {
  it('full + key → full', () => {
    expect(resolveRehearsalMode('full', true)).toBe('full');
  });

  it('full + no key → offline', () => {
    expect(resolveRehearsalMode('full', false)).toBe('offline');
  });

  it('offline + key → offline', () => {
    expect(resolveRehearsalMode('offline', true)).toBe('offline');
  });
});

// ---- aggregateSteps ----

describe('aggregateSteps', () => {
  it('full run with all steps produces correct summaries', () => {
    const steps = fullPassSteps();
    const result = aggregateSteps(steps, 'full');

    expect(result.doctor.total).toBe(1);
    expect(result.doctor.passed).toBe(1);
    expect(result.offline_gates.total).toBe(1);
    expect(result.canonical_demo.total).toBe(1);
    expect(result.online_eval).not.toBeNull();
    expect(result.online_eval!.total).toBe(1);
    expect(result.online_compare).not.toBeNull();
    expect(result.baseline_freeze).not.toBeNull();
  });

  it('offline mode sets online summaries to null', () => {
    const steps = offlineSteps();
    const result = aggregateSteps(steps, 'offline');

    expect(result.doctor.total).toBe(1);
    expect(result.online_eval).toBeNull();
    expect(result.online_compare).toBeNull();
    expect(result.baseline_freeze).toBeNull();
  });

  it('mixed pass/fail counts are correct', () => {
    const steps = [
      makePassStep('doctor'),
      makeFailStep('offline-gates'),
      makePassStep('canonical-demo'),
    ];
    const result = aggregateSteps(steps, 'offline');

    expect(result.doctor.passed).toBe(1);
    expect(result.offline_gates.failed).toBe(1);
    expect(result.canonical_demo.passed).toBe(1);
  });

  it('empty steps produce zero counts', () => {
    const result = aggregateSteps([], 'offline');
    expect(result.doctor.total).toBe(0);
    expect(result.offline_gates.total).toBe(0);
  });
});

// ---- computeVerdict ----

describe('computeVerdict', () => {
  it('all pass → pass', () => {
    expect(computeVerdict(fullPassSteps(), 'full')).toBe('pass');
  });

  it('any fail → fail', () => {
    const steps = fullPassSteps();
    steps[1] = makeFailStep('offline-gates');
    expect(computeVerdict(steps, 'full')).toBe('fail');
  });

  it('skip ≠ fail (skipped steps do not cause failure)', () => {
    const steps = [
      makePassStep('doctor'),
      makePassStep('offline-gates'),
      makePassStep('canonical-demo'),
      makeSkipStep('online-eval'),
      makeSkipStep('online-compare'),
      makeSkipStep('baseline-freeze'),
    ];
    expect(computeVerdict(steps, 'full')).toBe('pass');
  });

  it('offline mode ignores online failures', () => {
    const steps = [
      makePassStep('doctor'),
      makePassStep('offline-gates'),
      makePassStep('canonical-demo'),
      makeFailStep('online-eval'),
      makeFailStep('online-compare'),
      makeFailStep('baseline-freeze'),
    ];
    expect(computeVerdict(steps, 'offline')).toBe('pass');
  });

  it('doctor fail → fail', () => {
    const steps = [makeFailStep('doctor')];
    expect(computeVerdict(steps, 'offline')).toBe('fail');
  });
});

// ---- validateBaseline ----

describe('validateBaseline', () => {
  it('valid file passes', () => {
    const path = join(TMP_DIR, 'valid-baseline.json');
    writeFileSync(path, JSON.stringify(makeValidBaseline()));
    const result = validateBaseline(path);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.schema_version).toBe('1.0');
  });

  it('missing file returns not found', () => {
    const result = validateBaseline(join(TMP_DIR, 'nonexistent.json'));
    expect(result.exists).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('bad JSON returns parse error', () => {
    const path = join(TMP_DIR, 'bad.json');
    writeFileSync(path, '{not json');
    const result = validateBaseline(path);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Parse error');
  });

  it('wrong schema version returns error', () => {
    const path = join(TMP_DIR, 'wrong-version.json');
    const data = makeValidBaseline();
    data.schema_version = '99.0';
    writeFileSync(path, JSON.stringify(data));
    const result = validateBaseline(path);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('schema_version');
  });

  it('missing metrics returns error', () => {
    const path = join(TMP_DIR, 'no-metrics.json');
    const data = makeValidBaseline();
    delete (data as any).metrics;
    writeFileSync(path, JSON.stringify(data));
    const result = validateBaseline(path);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('metrics');
  });
});

// ---- buildRehearsalReport ----

describe('buildRehearsalReport', () => {
  it('offline report has correct shape', () => {
    const steps = offlineSteps();
    const report = buildRehearsalReport('offline', 'offline', steps, null, ['a.json'], [], 1234);

    expect(report.schema_version).toBe('1.0');
    expect(report.mode).toBe('offline');
    expect(report.effective_mode).toBe('offline');
    expect(report.verdict).toBe('pass');
    expect(report.go_no_go).toBe('GO');
    expect(report.baseline).toBeNull();
    expect(report.total_duration_ms).toBe(1234);
    expect(report.stage_summaries.online_eval).toBeNull();
  });

  it('full report has online summaries', () => {
    const steps = fullPassSteps();
    const baseline: BaselineValidation = { path: 'test', exists: true, valid: true, schema_version: '1.0' };
    const report = buildRehearsalReport('full', 'full', steps, baseline, [], [], 5678);

    expect(report.mode).toBe('full');
    expect(report.effective_mode).toBe('full');
    expect(report.stage_summaries.online_eval).not.toBeNull();
    expect(report.stage_summaries.online_compare).not.toBeNull();
    expect(report.baseline).not.toBeNull();
    expect(report.baseline!.valid).toBe(true);
  });

  it('go_no_go derived from verdict', () => {
    const passReport = buildRehearsalReport('offline', 'offline', offlineSteps(), null, [], [], 0);
    expect(passReport.go_no_go).toBe('GO');

    const failSteps = [makeFailStep('doctor'), ...offlineSteps().slice(1)];
    const failReport = buildRehearsalReport('offline', 'offline', failSteps, null, [], [], 0);
    expect(failReport.go_no_go).toBe('NO-GO');
  });

  it('includes git_commit when provided', () => {
    const report = buildRehearsalReport('offline', 'offline', offlineSteps(), null, [], [], 0, 'abc1234');
    expect(report.run_metadata.git_commit).toBe('abc1234');
  });
});

// ---- Schema conformance ----

describe('schema conformance', () => {
  let schema: Record<string, unknown>;

  beforeAll(() => {
    schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  });

  it('offline report conforms to schema', () => {
    const steps = offlineSteps();
    const report = buildRehearsalReport('offline', 'offline', steps, null, ['a.json'], ['test skip'], 1000);
    const errors = validateJsonSchema(report, schema, schema);
    expect(errors).toEqual([]);
  });

  it('full report conforms to schema', () => {
    const steps = fullPassSteps();
    const baseline: BaselineValidation = {
      path: 'benchmarks/online-eval-baseline-alpha.json',
      exists: true,
      valid: true,
      schema_version: '1.0',
      provenance: {
        frozen_at: '2026-01-01T00:00:00.000Z',
        source_report: 'artifacts/eval/online-eval-report.json',
      },
    };
    const report = buildRehearsalReport('full', 'full', steps, baseline, ['a.json'], [], 5000, 'abc1234');
    const errors = validateJsonSchema(report, schema, schema);
    expect(errors).toEqual([]);
  });

  it('null-fields report conforms to schema', () => {
    const steps = offlineSteps();
    const report = buildRehearsalReport('offline', 'offline', steps, null, [], [], 0);
    // baseline=null, online summaries=null, no git_commit
    const errors = validateJsonSchema(report, schema, schema);
    expect(errors).toEqual([]);
  });
});

// ---- Re-exported utilities ----

describe('re-exported utilities', () => {
  it('runStep executes echo successfully', () => {
    const step = runStep('test-echo', 'echo hello');
    expect(step.status).toBe('pass');
    expect(step.exit_code).toBe(0);
    expect(step.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('skipStep produces correct shape', () => {
    const step = skipStep('test-skip', 'echo nope', 'no reason');
    expect(step.status).toBe('skip');
    expect(step.exit_code).toBeNull();
    expect(step.duration_ms).toBe(0);
    expect(step.skip_reason).toBe('no reason');
  });
});

// ---- Committed baseline stub ----

describe('committed baseline stub', () => {
  it('online-eval-baseline-alpha.json exists and is valid JSON', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const data = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    expect(data.schema_version).toBe('1.0');
    expect(data._provenance).toBeDefined();
    expect(data.metrics.prompt_to_running_app_success_rate).toBe(0);
  });

  it('baseline stub conforms to online-eval-result schema', () => {
    const schemaPath = join(__dirname, '..', 'docs', 'online-eval-result.schema.json');
    const evalSchema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    const data = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    // _provenance is extra — strip it for validation
    const { _provenance, ...clean } = data;
    const errors = validateJsonSchema(clean, evalSchema, evalSchema);
    expect(errors).toEqual([]);
  });

  it('validateBaseline accepts the stub', () => {
    const result = validateBaseline(BASELINE_PATH);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.schema_version).toBe('1.0');
  });
});
