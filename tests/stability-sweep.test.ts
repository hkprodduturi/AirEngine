/**
 * Stability Sweep Tests (A8-prep)
 *
 * Tests outcome classification, case building, aggregation,
 * report building, schema conformance, and showcase manifest — all network-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifySweepOutcome,
  buildSweepCase,
  aggregateSweepSummary,
  buildSweepReport,
} from '../scripts/stability-sweep.js';
import type {
  SweepCase,
  SweepReport,
  SweepSummary,
  SweepCaseSource,
  SweepOutcome,
} from '../scripts/stability-sweep.js';
import type { LoopResult, LoopStage } from '../src/cli/loop.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Helpers ----

const SCHEMA_PATH = join(__dirname, '..', 'docs', 'stability-sweep-result.schema.json');
const MANIFEST_PATH = join(__dirname, '..', 'examples', 'showcase-manifest.json');

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
    diagnostics: {
      valid: true,
      summary: { errors: 0, warnings: 0, info: 0, fixable: 0 },
      diagnostics: [],
      sourceHash: 'abc123',
      engineVersion: '0.2.0',
    },
    transpileResult: {
      files: [
        { path: 'App.jsx', content: 'export default function App() {}' },
        { path: 'package.json', content: '{"name":"test"}' },
      ],
      stats: { outputLines: 10, inputLines: 5, compressionRatio: 2, totalMs: 5, extractMs: 1, analyzeMs: 1, clientGenMs: 2, serverGenMs: 1 },
      provenance: { generatedBy: 'AirEngine', version: '0.2.0', sourceFile: 'test.air' },
    },
    outputDir: '/tmp/test',
    artifactDir: '.air-artifacts/test',
    determinismCheck: {
      sourceHash: 'abc123',
      outputHashes: { 'App.jsx': 'hash1', 'package.json': 'hash2' },
      deterministic: true,
    },
    ...overrides,
  };
}

function makeSweepCase(overrides: Partial<SweepCase> = {}): SweepCase {
  return {
    id: 'showcase:todo',
    source: 'showcase',
    outcome: 'success',
    stages: [
      { name: 'validate', status: 'pass', duration_ms: 5 },
      { name: 'repair', status: 'skip', duration_ms: 0 },
      { name: 'transpile', status: 'pass', duration_ms: 10 },
      { name: 'smoke', status: 'pass', duration_ms: 1 },
      { name: 'determinism', status: 'pass', duration_ms: 8 },
    ],
    file_count: 9,
    deterministic: true,
    duration_ms: 50,
    ...overrides,
  };
}

// ---- classifySweepOutcome ----

describe('classifySweepOutcome', () => {
  it('returns success when all stages pass or skip', () => {
    const result = makeLoopResult();
    expect(classifySweepOutcome(result)).toBe('success');
  });

  it('returns loop_failed_transpile when transpile fails', () => {
    const result = makeLoopResult({
      stages: [
        makeLoopStage('validate'),
        makeLoopStage('repair', 'skip'),
        makeLoopStage('transpile', 'fail'),
      ],
    });
    expect(classifySweepOutcome(result)).toBe('loop_failed_transpile');
  });

  it('returns loop_failed_smoke when smoke fails', () => {
    const result = makeLoopResult({
      stages: [
        makeLoopStage('validate'),
        makeLoopStage('repair', 'skip'),
        makeLoopStage('transpile'),
        makeLoopStage('smoke', 'fail'),
      ],
    });
    expect(classifySweepOutcome(result)).toBe('loop_failed_smoke');
  });

  it('returns loop_failed_determinism when determinism fails', () => {
    const result = makeLoopResult({
      stages: [
        makeLoopStage('validate'),
        makeLoopStage('repair', 'skip'),
        makeLoopStage('transpile'),
        makeLoopStage('smoke'),
        makeLoopStage('determinism', 'fail'),
      ],
    });
    expect(classifySweepOutcome(result)).toBe('loop_failed_determinism');
  });
});

// ---- buildSweepCase ----

describe('buildSweepCase', () => {
  it('builds a showcase case with file and complexity', () => {
    const loopResult = makeLoopResult();
    const c = buildSweepCase('showcase:todo', 'showcase', loopResult, 100, {
      file: 'examples/todo.air',
      complexity: 'simple',
    });
    expect(c.id).toBe('showcase:todo');
    expect(c.source).toBe('showcase');
    expect(c.file).toBe('examples/todo.air');
    expect(c.complexity).toBe('simple');
    expect(c.outcome).toBe('success');
    expect(c.stages.length).toBe(5);
    expect(c.file_count).toBe(2);
    expect(c.deterministic).toBe(true);
    expect(c.duration_ms).toBe(100);
  });

  it('builds a replay case with fixture_id', () => {
    const loopResult = makeLoopResult();
    const c = buildSweepCase('replay:todo', 'replay', loopResult, 80, {
      fixture_id: 'todo',
    });
    expect(c.id).toBe('replay:todo');
    expect(c.source).toBe('replay');
    expect(c.fixture_id).toBe('todo');
    expect(c.outcome).toBe('success');
  });

  it('builds a live case with error', () => {
    const loopResult = makeLoopResult({
      stages: [
        makeLoopStage('validate'),
        makeLoopStage('repair', 'skip'),
        makeLoopStage('transpile', 'fail'),
      ],
      transpileResult: undefined,
    });
    const c = buildSweepCase('live:simple-todo', 'live', loopResult, 5000, {
      prompt: 'Build a todo app',
      complexity: 'simple',
      error: 'Transpile failed',
    });
    expect(c.id).toBe('live:simple-todo');
    expect(c.source).toBe('live');
    expect(c.prompt).toBe('Build a todo app');
    expect(c.outcome).toBe('loop_failed_transpile');
    expect(c.error).toBe('Transpile failed');
    expect(c.file_count).toBeUndefined();
  });
});

// ---- aggregateSweepSummary ----

describe('aggregateSweepSummary', () => {
  it('aggregates all-passing cases', () => {
    const cases = [
      makeSweepCase({ id: 'showcase:todo', source: 'showcase' }),
      makeSweepCase({ id: 'showcase:landing', source: 'showcase' }),
      makeSweepCase({ id: 'replay:todo', source: 'replay' }),
    ];
    const summary = aggregateSweepSummary(cases);
    expect(summary.total).toBe(3);
    expect(summary.success).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.by_source.showcase).toEqual({ total: 2, success: 2, failed: 0 });
    expect(summary.by_source.replay).toEqual({ total: 1, success: 1, failed: 0 });
    expect(summary.by_source.live).toEqual({ total: 0, success: 0, failed: 0 });
    expect(summary.by_outcome.success).toBe(3);
  });

  it('aggregates mixed results', () => {
    const cases = [
      makeSweepCase({ id: 'showcase:todo', source: 'showcase', outcome: 'success' }),
      makeSweepCase({ id: 'showcase:auth', source: 'showcase', outcome: 'loop_failed_smoke' }),
      makeSweepCase({ id: 'replay:todo', source: 'replay', outcome: 'success' }),
      makeSweepCase({ id: 'live:x', source: 'live', outcome: 'generation_failed' }),
    ];
    const summary = aggregateSweepSummary(cases);
    expect(summary.total).toBe(4);
    expect(summary.success).toBe(2);
    expect(summary.failed).toBe(2);
    expect(summary.by_source.showcase).toEqual({ total: 2, success: 1, failed: 1 });
    expect(summary.by_source.live).toEqual({ total: 1, success: 0, failed: 1 });
    expect(summary.by_outcome.loop_failed_smoke).toBe(1);
    expect(summary.by_outcome.generation_failed).toBe(1);
  });

  it('handles empty cases array', () => {
    const summary = aggregateSweepSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.success).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.by_source.showcase).toEqual({ total: 0, success: 0, failed: 0 });
  });
});

// ---- buildSweepReport ----

describe('buildSweepReport', () => {
  it('builds an offline report with correct shape', () => {
    const cases = [makeSweepCase()];
    const report = buildSweepReport('offline', cases, [], 500);
    expect(report.schema_version).toBe('1.0');
    expect(report.mode).toBe('offline');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.run_metadata.airengine_version).toBe('0.2.0');
    expect(report.cases).toHaveLength(1);
    expect(report.summary.total).toBe(1);
    expect(report.issues).toHaveLength(0);
    expect(report.total_duration_ms).toBe(500);
  });

  it('builds a full report with issues and git commit', () => {
    const cases = [
      makeSweepCase({ id: 'showcase:todo', outcome: 'success' }),
      makeSweepCase({ id: 'live:x', source: 'live', outcome: 'generation_failed' }),
    ];
    const issues = [{ id: 'SWEEP-1', severity: 'P2', message: 'live:x generation failed' }];
    const report = buildSweepReport('full', cases, issues, 10000, 'abc1234');
    expect(report.mode).toBe('full');
    expect(report.run_metadata.git_commit).toBe('abc1234');
    expect(report.issues).toHaveLength(1);
    expect(report.summary.failed).toBe(1);
  });

  it('builds a report with no cases', () => {
    const report = buildSweepReport('offline', [], [], 10);
    expect(report.cases).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });
});

// ---- Schema conformance ----

describe('Schema conformance', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

  it('offline report conforms to schema', () => {
    const cases = [
      makeSweepCase({ id: 'showcase:todo', source: 'showcase', file: 'examples/todo.air', complexity: 'simple' }),
      makeSweepCase({ id: 'replay:todo', source: 'replay', fixture_id: 'todo' }),
    ];
    const report = buildSweepReport('offline', cases, [], 500);
    const errors = validateJsonSchema(report, schema, schema);
    expect(errors).toEqual([]);
  });

  it('full report with issues conforms to schema', () => {
    const cases = [
      makeSweepCase({ id: 'showcase:todo', source: 'showcase' }),
      makeSweepCase({ id: 'live:x', source: 'live', outcome: 'generation_failed', prompt: 'Build X', error: 'fail' }),
    ];
    const issues = [{ id: 'SWEEP-1', severity: 'P1', message: 'Something failed' }];
    const report = buildSweepReport('full', cases, issues, 9000, 'deadbeef');
    const errors = validateJsonSchema(report, schema, schema);
    expect(errors).toEqual([]);
  });

  it('empty report conforms to schema', () => {
    const report = buildSweepReport('offline', [], [], 10);
    const errors = validateJsonSchema(report, schema, schema);
    expect(errors).toEqual([]);
  });
});

// ---- Showcase manifest ----

describe('Showcase manifest', () => {
  it('loads and parses', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    expect(manifest.schema_version).toBe('2.0');
    expect(Array.isArray(manifest.examples)).toBe(true);
  });

  it('has 9 complex showcase entries', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    expect(manifest.examples).toHaveLength(9);
    const ids = manifest.examples.map((e: any) => e.id);
    expect(ids).toContain('helpdesk');
    expect(ids).toContain('projectflow');
    expect(ids).toContain('ecommerce');
    expect(ids).toContain('crm-sales-pipeline');
    expect(ids).toContain('photography-studio-premium');
    // All entries should be complex
    for (const ex of manifest.examples) {
      expect(ex.complexity).toBe('complex');
    }
  });
});
