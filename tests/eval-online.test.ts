/**
 * A6c Online Eval Harness Tests
 *
 * Tests corpus loading, outcome classification, metric aggregation,
 * report building, and schema conformance — all network-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  loadCorpus,
  classifyOutcome,
  computeMetrics,
  buildReport,
} from '../scripts/eval-online.js';
import type {
  CaseResult,
  OutcomeCategory,
  OnlineEvalReport,
  CorpusEntry,
} from '../scripts/eval-online.js';
import type { GeneratorResult } from '../src/generator.js';
import type { LoopResult, LoopStage } from '../src/cli/loop.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Helpers ----

const CORPUS_PATH = join(__dirname, '..', 'benchmarks', 'online-eval-corpus.json');
const SCHEMA_PATH = join(__dirname, '..', 'docs', 'online-eval-result.schema.json');

function makeGenResult(overrides: Partial<GeneratorResult> = {}): GeneratorResult {
  return {
    success: true,
    source: '@app:test\n@ui\n  h1 "Hello"',
    metadata: {
      adapter: 'claude',
      promptHash: 'abc123',
      durationMs: 1000,
      model: 'claude-sonnet-4-20250514',
      attempts: 1,
      inputTokens: 500,
      outputTokens: 200,
    },
    ...overrides,
  };
}

function makeLoopStage(name: string, status: 'pass' | 'fail' | 'skip' = 'pass', durationMs = 10): LoopStage {
  return { name, status, durationMs };
}

function makeLoopResult(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    file: '<source>',
    timestamp: new Date().toISOString(),
    stages: [
      makeLoopStage('validate'),
      makeLoopStage('repair', 'skip'),
      makeLoopStage('transpile'),
      makeLoopStage('smoke'),
      makeLoopStage('determinism'),
    ],
    diagnostics: { file: '<source>', timestamp: '', diagnostics: [], counts: { errors: 0, warnings: 0, info: 0, total: 0 } },
    outputDir: '/tmp/test',
    artifactDir: '/tmp/test/.air-artifacts',
    determinismCheck: { sourceHash: 'abc', outputHashes: { 'App.jsx': 'def' }, deterministic: true },
    ...overrides,
  };
}

function makeCaseResult(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    id: 'test-case',
    prompt_hash: 'abc123',
    outcome: 'success_running_app',
    generation: {
      success: true,
      duration_ms: 1000,
      model: 'claude-sonnet-4-20250514',
      attempts: 1,
      input_tokens: 500,
      output_tokens: 200,
    },
    loop: {
      stages: [
        { name: 'validate', status: 'pass', duration_ms: 5 },
        { name: 'repair', status: 'skip', duration_ms: 0 },
        { name: 'transpile', status: 'pass', duration_ms: 20 },
        { name: 'smoke', status: 'pass', duration_ms: 10 },
        { name: 'determinism', status: 'pass', duration_ms: 15 },
      ],
      deterministic: true,
      file_count: 5,
      output_lines: 100,
    },
    total_duration_ms: 1050,
    ...overrides,
  };
}

// ---- loadCorpus ----

describe('loadCorpus', () => {
  it('loads valid corpus with all 10 entries', () => {
    const { corpus, entries } = loadCorpus(CORPUS_PATH);
    expect(corpus.schema_version).toBe('1.0');
    expect(corpus.corpus_id).toBe('online-eval-v1');
    expect(entries).toHaveLength(10);
    for (const entry of entries) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.prompt).toBe('string');
      expect(typeof entry.category).toBe('string');
      expect(['simple', 'medium', 'complex']).toContain(entry.complexity);
    }
  });

  it('applies limit to filter entries', () => {
    const { entries } = loadCorpus(CORPUS_PATH, 3);
    expect(entries).toHaveLength(3);
    expect(entries[0].id).toBe('simple-todo');
    expect(entries[2].id).toBe('simple-landing');
  });

  it('rejects corpus with missing schema_version', () => {
    const tmpPath = join(__dirname, '..', 'benchmarks', '__test_invalid.json');
    const { writeFileSync, unlinkSync } = require('fs');
    writeFileSync(tmpPath, JSON.stringify({ entries: [] }));
    try {
      expect(() => loadCorpus(tmpPath)).toThrow('missing schema_version');
    } finally {
      unlinkSync(tmpPath);
    }
  });

  it('rejects corpus with missing entry fields', () => {
    const tmpPath = join(__dirname, '..', 'benchmarks', '__test_invalid2.json');
    const { writeFileSync, unlinkSync } = require('fs');
    writeFileSync(tmpPath, JSON.stringify({
      schema_version: '1.0',
      corpus_id: 'test',
      entries: [{ id: 'bad' }],
    }));
    try {
      expect(() => loadCorpus(tmpPath)).toThrow('missing prompt');
    } finally {
      unlinkSync(tmpPath);
    }
  });
});

// ---- classifyOutcome ----

describe('classifyOutcome', () => {
  it('returns success_running_app when all stages pass', () => {
    const gen = makeGenResult();
    const loop = makeLoopResult();
    expect(classifyOutcome(gen, loop)).toBe('success_running_app');
  });

  it('returns generation_failed_auth on auth error', () => {
    const gen = makeGenResult({ success: false, error: 'Authentication failed: 401' });
    expect(classifyOutcome(gen)).toBe('generation_failed_auth');
  });

  it('returns generation_failed_provider on HTTP/timeout error', () => {
    const gen = makeGenResult({ success: false, error: 'HTTP 500: Internal Server Error' });
    expect(classifyOutcome(gen)).toBe('generation_failed_provider');

    const gen2 = makeGenResult({ success: false, error: 'Request timed out' });
    expect(classifyOutcome(gen2)).toBe('generation_failed_provider');
  });

  it('returns generation_failed_invalid_air when gen succeeds but no loop result', () => {
    const gen = makeGenResult();
    expect(classifyOutcome(gen, undefined)).toBe('generation_failed_invalid_air');
  });

  it('returns generation_failed_invalid_air when gen fails with unknown error', () => {
    const gen = makeGenResult({ success: false, error: 'Some unknown error' });
    expect(classifyOutcome(gen)).toBe('generation_failed_invalid_air');
  });

  it('does not misclassify parse errors containing digit 5 as provider failure', () => {
    const gen = makeGenResult({ success: false, error: 'Parse error at line 5, column 15' });
    expect(classifyOutcome(gen)).toBe('generation_failed_invalid_air');
  });

  it('correctly classifies HTTP 502/503 as provider failure', () => {
    const gen502 = makeGenResult({ success: false, error: 'HTTP 502: Bad Gateway' });
    expect(classifyOutcome(gen502)).toBe('generation_failed_provider');

    const gen503 = makeGenResult({ success: false, error: 'HTTP 503: Service Unavailable' });
    expect(classifyOutcome(gen503)).toBe('generation_failed_provider');
  });

  it('maps loop stage failures to corresponding outcomes', () => {
    const gen = makeGenResult();

    const cases: Array<[string, OutcomeCategory]> = [
      ['validate', 'loop_failed_validation'],
      ['repair', 'loop_failed_repair'],
      ['transpile', 'loop_failed_transpile'],
      ['smoke', 'loop_failed_smoke'],
      ['determinism', 'loop_failed_determinism'],
    ];

    for (const [stageName, expected] of cases) {
      const loop = makeLoopResult({
        stages: [
          makeLoopStage('validate'),
          makeLoopStage('repair', 'skip'),
          makeLoopStage('transpile'),
          makeLoopStage('smoke'),
          makeLoopStage('determinism'),
        ].map(s => s.name === stageName ? { ...s, status: 'fail' as const } : s),
      });
      expect(classifyOutcome(gen, loop)).toBe(expected);
    }
  });

  it('repair pass compensates validate fail', () => {
    const gen = makeGenResult();
    const loop = makeLoopResult({
      stages: [
        makeLoopStage('validate', 'fail'),
        makeLoopStage('repair', 'pass'),
        makeLoopStage('transpile', 'pass'),
        makeLoopStage('smoke', 'pass'),
        makeLoopStage('determinism', 'pass'),
      ],
    });
    expect(classifyOutcome(gen, loop)).toBe('success_running_app');
  });

  it('returns unexpected_error when error is provided', () => {
    const gen = makeGenResult();
    expect(classifyOutcome(gen, undefined, new Error('boom'))).toBe('unexpected_error');
  });

  it('returns generation_failed_invalid_air for undefined genResult', () => {
    expect(classifyOutcome(undefined)).toBe('generation_failed_invalid_air');
  });
});

// ---- computeMetrics ----

describe('computeMetrics', () => {
  it('computes correct metrics for all-success cases', () => {
    const cases = [
      makeCaseResult({ id: 'a', total_duration_ms: 1000 }),
      makeCaseResult({ id: 'b', total_duration_ms: 2000 }),
      makeCaseResult({ id: 'c', total_duration_ms: 3000 }),
    ];

    const m = computeMetrics(cases);
    expect(m.total_cases).toBe(3);
    expect(m.completed_cases).toBe(3);
    expect(m.success_count).toBe(3);
    expect(m.prompt_to_running_app_success_rate).toBe(1);
    expect(m.prompt_to_air_success_rate).toBe(1);
    expect(m.failure_breakdown.success_running_app).toBe(3);
    expect(m.failure_breakdown.generation_failed_auth).toBe(0);
  });

  it('computes correct metrics for mixed results', () => {
    const cases = [
      makeCaseResult({ id: 'ok', outcome: 'success_running_app', total_duration_ms: 1000 }),
      makeCaseResult({
        id: 'gen-fail',
        outcome: 'generation_failed_provider',
        total_duration_ms: 500,
        generation: { success: false, duration_ms: 500, error: 'HTTP 500' },
        loop: undefined,
      }),
      makeCaseResult({
        id: 'loop-fail',
        outcome: 'loop_failed_transpile',
        total_duration_ms: 2000,
      }),
    ];

    const m = computeMetrics(cases);
    expect(m.total_cases).toBe(3);
    expect(m.success_count).toBe(1);
    expect(m.prompt_to_running_app_success_rate).toBeCloseTo(0.333, 2);
    expect(m.failure_breakdown.success_running_app).toBe(1);
    expect(m.failure_breakdown.generation_failed_provider).toBe(1);
    expect(m.failure_breakdown.loop_failed_transpile).toBe(1);
    // p50/p95 should be computed with 3 values
    expect(m.timing.p50_total_ms).toBeGreaterThan(0);
    expect(m.timing.p95_total_ms).toBeGreaterThan(0);
  });

  it('handles empty cases array', () => {
    const m = computeMetrics([]);
    expect(m.total_cases).toBe(0);
    expect(m.completed_cases).toBe(0);
    expect(m.success_count).toBe(0);
    expect(m.prompt_to_air_success_rate).toBe(0);
    expect(m.prompt_to_running_app_success_rate).toBe(0);
    expect(m.timing.avg_total_ms).toBe(0);
    expect(m.timing.p50_total_ms).toBe(0);
    expect(m.timing.p95_total_ms).toBe(0);
    expect(m.tokens.total_input).toBe(0);
    expect(m.tokens.total_output).toBe(0);
  });

  it('handles single case (p50/p95 = 0 with < 2 items)', () => {
    const m = computeMetrics([makeCaseResult({ total_duration_ms: 1000 })]);
    expect(m.total_cases).toBe(1);
    expect(m.timing.p50_total_ms).toBe(0);
    expect(m.timing.p95_total_ms).toBe(0);
  });

  it('sums tokens correctly', () => {
    const cases = [
      makeCaseResult({ id: 'a', generation: { success: true, duration_ms: 1000, input_tokens: 100, output_tokens: 50 } }),
      makeCaseResult({ id: 'b', generation: { success: true, duration_ms: 2000, input_tokens: 200, output_tokens: 100 } }),
    ];
    const m = computeMetrics(cases);
    expect(m.tokens.total_input).toBe(300);
    expect(m.tokens.total_output).toBe(150);
    expect(m.tokens.avg_input).toBe(150);
    expect(m.tokens.avg_output).toBe(75);
  });
});

// ---- buildReport ----

describe('buildReport', () => {
  it('produces a complete report', () => {
    const cases = [makeCaseResult()];
    const report = buildReport(
      cases,
      {
        generator_model: 'claude-sonnet-4-20250514',
        repair_mode: 'deterministic',
        max_repair_attempts: 1,
        timeout_ms: 30000,
        provider_retries: 2,
      },
      {
        path: 'benchmarks/online-eval-corpus.json',
        total_entries: 10,
        limit_applied: 1,
        corpus_id: 'online-eval-v1',
      },
      '/tmp/artifacts',
    );

    expect(report.schema_version).toBe('1.0');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.run_metadata.airengine_version).toBe('0.2.0');
    expect(report.run_metadata.node_version).toBe(process.version);
    expect(report.run_metadata.platform).toBe(process.platform);
    expect(report.config.generator_model).toBe('claude-sonnet-4-20250514');
    expect(report.corpus.total_entries).toBe(10);
    expect(report.corpus.limit_applied).toBe(1);
    expect(report.cases).toHaveLength(1);
    expect(report.metrics.total_cases).toBe(1);
    expect(report.artifact_dir).toBe('/tmp/artifacts');
  });

  it('includes git_commit when provided', () => {
    const report = buildReport(
      [],
      {
        generator_model: 'test',
        repair_mode: 'none',
        max_repair_attempts: 1,
        timeout_ms: 30000,
        provider_retries: 2,
      },
      { path: 'test', total_entries: 0, limit_applied: null, corpus_id: 'test' },
      '/tmp',
      'abc1234',
    );
    expect(report.run_metadata.git_commit).toBe('abc1234');
  });

  it('omits git_commit when not provided', () => {
    const report = buildReport(
      [],
      {
        generator_model: 'test',
        repair_mode: 'none',
        max_repair_attempts: 1,
        timeout_ms: 30000,
        provider_retries: 2,
      },
      { path: 'test', total_entries: 0, limit_applied: null, corpus_id: 'test' },
      '/tmp',
    );
    expect(report.run_metadata.git_commit).toBeUndefined();
  });
});

// ---- Schema Conformance ----

describe('schema conformance', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

  it('full report conforms to online-eval-result.schema.json', () => {
    const cases = [
      makeCaseResult({ id: 'a', outcome: 'success_running_app' }),
      makeCaseResult({
        id: 'b',
        outcome: 'generation_failed_provider',
        generation: { success: false, duration_ms: 500, error: 'HTTP 500' },
        loop: undefined,
      }),
    ];
    const report = buildReport(
      cases,
      {
        generator_model: 'claude-sonnet-4-20250514',
        repair_mode: 'deterministic',
        max_repair_attempts: 1,
        timeout_ms: 30000,
        provider_retries: 2,
      },
      {
        path: 'benchmarks/online-eval-corpus.json',
        total_entries: 10,
        limit_applied: 2,
        corpus_id: 'online-eval-v1',
      },
      '/tmp/artifacts',
      'abc1234',
    );

    // Round-trip through JSON to drop undefined fields
    const serialized = JSON.parse(JSON.stringify(report));
    const errors = validateJsonSchema(serialized, schema, schema);
    expect(errors).toEqual([]);
  });

  it('report with optional repair fields conforms', () => {
    const cases = [
      makeCaseResult({
        id: 'repaired',
        outcome: 'success_running_app',
        loop: {
          stages: [
            { name: 'validate', status: 'fail', duration_ms: 5 },
            { name: 'repair', status: 'pass', duration_ms: 100 },
            { name: 'transpile', status: 'pass', duration_ms: 20 },
            { name: 'smoke', status: 'pass', duration_ms: 10 },
            { name: 'determinism', status: 'pass', duration_ms: 15 },
          ],
          repair_attempts: 2,
          deterministic: true,
          file_count: 5,
          output_lines: 100,
        },
      }),
    ];
    const report = buildReport(
      cases,
      {
        generator_model: 'claude-sonnet-4-20250514',
        repair_mode: 'claude',
        max_repair_attempts: 3,
        timeout_ms: 30000,
        provider_retries: 2,
        repair_model: 'claude-sonnet-4-20250514',
        repair_provider_retries: 2,
      },
      {
        path: 'benchmarks/online-eval-corpus.json',
        total_entries: 10,
        limit_applied: null,
        corpus_id: 'online-eval-v1',
      },
      '/tmp/artifacts',
    );

    const serialized = JSON.parse(JSON.stringify(report));
    const errors = validateJsonSchema(serialized, schema, schema);
    expect(errors).toEqual([]);
  });

  it('empty report conforms', () => {
    const report = buildReport(
      [],
      {
        generator_model: 'test-model',
        repair_mode: 'none',
        max_repair_attempts: 1,
        timeout_ms: 30000,
        provider_retries: 2,
      },
      {
        path: 'test.json',
        total_entries: 0,
        limit_applied: null,
        corpus_id: 'test',
      },
      '/tmp',
    );

    const serialized = JSON.parse(JSON.stringify(report));
    const errors = validateJsonSchema(serialized, schema, schema);
    expect(errors).toEqual([]);
  });
});

// ---- Env-gated live test ----

describe('live eval (env-gated)', () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  it.skipIf(!apiKey)('runs 1 prompt and produces valid report', async () => {
    const { createClaudeAdapter } = await import('../src/generator.js');
    const { runLoopFromSource } = await import('../src/cli/loop.js');
    const { tmpdir } = await import('os');
    const { mkdirSync } = await import('fs');

    const adapter = createClaudeAdapter({ apiKey: apiKey! });
    const prompt = 'Build a simple counter app with increment and decrement buttons.';

    const genResult = await adapter.generate(prompt);
    expect(genResult.success).toBe(true);
    expect(genResult.source.length).toBeGreaterThan(0);

    if (genResult.success && genResult.source) {
      const tmpDir = join(tmpdir(), `eval-live-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      const loopResult = await runLoopFromSource(genResult.source, tmpDir, {
        repairMode: 'deterministic',
        writeArtifacts: false,
      });
      expect(loopResult.stages.length).toBeGreaterThan(0);
    }
  }, 60000);
});
