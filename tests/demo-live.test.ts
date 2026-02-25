/**
 * A5d Canonical Live Demo Tests
 *
 * Tests for demo-live-canonical.ts — arg parsing, prompt loading,
 * outcome classification, result building, and schema conformance.
 * All network-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseArgs,
  loadCanonicalPrompt,
  classifyDemoOutcome,
  buildDemoResult,
  extractLoopSummary,
  formatPresenterSummary,
} from '../scripts/demo-live-canonical.js';
import type {
  DemoResult,
  DemoOutcome,
  PromptMetadata,
  GeneratorMetadata,
  LoopSummary,
  CliArgs,
} from '../scripts/demo-live-canonical.js';
import type { GeneratorResult } from '../src/generator.js';
import type { LoopResult, LoopStage } from '../src/cli/loop.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Helpers ----

const SCHEMA_PATH = join(__dirname, '..', 'docs', 'canonical-live-demo-result.schema.json');
const PROMPT_PATH = join(__dirname, '..', 'benchmarks', 'canonical-demo-prompt.json');

function makePromptMeta(overrides: Partial<PromptMetadata> = {}): PromptMetadata {
  return {
    text: 'Build a fullstack todo app',
    hash: 'abc123',
    char_count: 26,
    source: 'canonical',
    ...overrides,
  };
}

function makeGenMeta(overrides: Partial<GeneratorMetadata> = {}): GeneratorMetadata {
  return {
    adapter: 'replay',
    duration_ms: 5,
    fixture_id: 'fullstack-todo',
    ...overrides,
  };
}

function makeLoopSummary(overrides: Partial<LoopSummary> = {}): LoopSummary {
  return {
    stages: [
      { name: 'validate', status: 'pass', duration_ms: 5 },
      { name: 'repair', status: 'skip', duration_ms: 0 },
      { name: 'transpile', status: 'pass', duration_ms: 20 },
      { name: 'smoke', status: 'pass', duration_ms: 10 },
      { name: 'determinism', status: 'pass', duration_ms: 15 },
    ],
    repair_mode: 'deterministic',
    deterministic: true,
    file_count: 50,
    output_lines: 2200,
    ...overrides,
  };
}

function makeGenResult(overrides: Partial<GeneratorResult> = {}): GeneratorResult {
  return {
    success: true,
    source: '@app:test\n@ui\n  h1 "Hello"',
    metadata: { adapter: 'replay', promptHash: 'abc', durationMs: 5, fixtureId: 'fullstack-todo' },
    ...overrides,
  };
}

function makeLoopResult(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    file: '<source>',
    timestamp: new Date().toISOString(),
    stages: [
      { name: 'validate', status: 'pass', durationMs: 5 },
      { name: 'repair', status: 'skip', durationMs: 0 },
      { name: 'transpile', status: 'pass', durationMs: 20 },
      { name: 'smoke', status: 'pass', durationMs: 10 },
      { name: 'determinism', status: 'pass', durationMs: 15 },
    ],
    diagnostics: { file: '<source>', timestamp: '', diagnostics: [], counts: { errors: 0, warnings: 0, info: 0, total: 0 } },
    outputDir: '/tmp/test',
    artifactDir: '/tmp/test/.air-artifacts',
    determinismCheck: { sourceHash: 'abc', outputHashes: { 'App.jsx': 'def' }, deterministic: true },
    ...overrides,
  };
}

// ---- parseArgs ----

describe('parseArgs', () => {
  it('parses default args', () => {
    const args = parseArgs([]);
    expect(args.adapter).toBe('replay');
    expect(args.repairMode).toBe('deterministic');
    expect(args.maxRepairAttempts).toBe(1);
    expect(args.verbose).toBe(false);
    expect(args.keepOutput).toBe(false);
  });

  it('parses --adapter claude', () => {
    const args = parseArgs(['--adapter', 'claude']);
    expect(args.adapter).toBe('claude');
  });

  it('parses --prompt override', () => {
    const args = parseArgs(['--prompt', 'Build a counter']);
    expect(args.prompt).toBe('Build a counter');
  });

  it('parses all flags', () => {
    const args = parseArgs([
      '--adapter', 'claude',
      '--repair-mode', 'claude',
      '--max-repair-attempts', '3',
      '--generator-model', 'claude-opus-4-20250514',
      '--timeout-ms', '60000',
      '--keep-output',
      '--verbose',
    ]);
    expect(args.adapter).toBe('claude');
    expect(args.repairMode).toBe('claude');
    expect(args.maxRepairAttempts).toBe(3);
    expect(args.generatorModel).toBe('claude-opus-4-20250514');
    expect(args.timeoutMs).toBe(60000);
    expect(args.keepOutput).toBe(true);
    expect(args.verbose).toBe(true);
  });
});

// ---- loadCanonicalPrompt ----

describe('loadCanonicalPrompt', () => {
  it('loads the canonical prompt file', () => {
    const prompt = loadCanonicalPrompt(PROMPT_PATH);
    expect(prompt.demo_id).toBe('canonical-fullstack-todo');
    expect(typeof prompt.prompt).toBe('string');
    expect(prompt.prompt.length).toBeGreaterThan(10);
  });

  it('throws on missing file', () => {
    expect(() => loadCanonicalPrompt('/nonexistent/file.json')).toThrow();
  });
});

// ---- classifyDemoOutcome ----

describe('classifyDemoOutcome', () => {
  it('returns success when gen and loop pass', () => {
    expect(classifyDemoOutcome(makeGenResult(), makeLoopResult())).toBe('success');
  });

  it('returns generation_failed when gen fails', () => {
    const gen = makeGenResult({ success: false, error: 'failed' });
    expect(classifyDemoOutcome(gen)).toBe('generation_failed');
  });

  it('returns generation_failed when no loop result', () => {
    expect(classifyDemoOutcome(makeGenResult(), undefined)).toBe('generation_failed');
  });

  it('returns loop_failed when a stage fails', () => {
    const loop = makeLoopResult({
      stages: [
        { name: 'validate', status: 'pass', durationMs: 5 },
        { name: 'repair', status: 'skip', durationMs: 0 },
        { name: 'transpile', status: 'fail', durationMs: 20 },
        { name: 'smoke', status: 'skip', durationMs: 0 },
        { name: 'determinism', status: 'skip', durationMs: 0 },
      ],
    });
    expect(classifyDemoOutcome(makeGenResult(), loop)).toBe('loop_failed');
  });

  it('repair pass compensates validate fail', () => {
    const loop = makeLoopResult({
      stages: [
        { name: 'validate', status: 'fail', durationMs: 5 },
        { name: 'repair', status: 'pass', durationMs: 100 },
        { name: 'transpile', status: 'pass', durationMs: 20 },
        { name: 'smoke', status: 'pass', durationMs: 10 },
        { name: 'determinism', status: 'pass', durationMs: 15 },
      ],
    });
    expect(classifyDemoOutcome(makeGenResult(), loop)).toBe('success');
  });

  it('returns unexpected_error on error', () => {
    expect(classifyDemoOutcome(undefined, undefined, new Error('boom'))).toBe('unexpected_error');
  });
});

// ---- buildDemoResult ----

describe('buildDemoResult', () => {
  it('produces a complete success result', () => {
    const result = buildDemoResult(
      makePromptMeta(),
      makeGenMeta(),
      makeLoopSummary(),
      'success',
      100,
      { report: 'report.json', generated_air: 'gen.air', output_dir: '/tmp/out' },
    );
    expect(result.schema_version).toBe('1.0');
    expect(result.success).toBe(true);
    expect(result.outcome).toBe('success');
    expect(result.total_duration_ms).toBe(100);
  });

  it('produces a failure result with error', () => {
    const result = buildDemoResult(
      makePromptMeta(),
      makeGenMeta({ adapter: 'claude' }),
      null,
      'missing_api_key',
      5,
      { report: 'report.json' },
      'ANTHROPIC_API_KEY not set',
    );
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('missing_api_key');
    expect(result.error).toBe('ANTHROPIC_API_KEY not set');
    expect(result.loop).toBeNull();
  });
});

// ---- extractLoopSummary ----

describe('extractLoopSummary', () => {
  it('extracts summary from loop result', () => {
    const loop = makeLoopResult();
    const summary = extractLoopSummary(loop, 'deterministic');
    expect(summary.stages).toHaveLength(5);
    expect(summary.repair_mode).toBe('deterministic');
    expect(summary.deterministic).toBe(true);
  });
});

// ---- formatPresenterSummary ----

describe('formatPresenterSummary', () => {
  it('produces a string with key info', () => {
    const result = buildDemoResult(
      makePromptMeta(),
      makeGenMeta(),
      makeLoopSummary(),
      'success',
      100,
      { report: 'report.json' },
    );
    const summary = formatPresenterSummary(result);
    expect(typeof summary).toBe('string');
    expect(summary).toContain('SUCCESS');
    expect(summary).toContain('replay');
    expect(summary).toContain('Pipeline');
  });

  it('does not crash for failure result', () => {
    const result = buildDemoResult(
      makePromptMeta(),
      makeGenMeta(),
      null,
      'generation_failed',
      5,
      { report: 'report.json' },
      'Generation failed',
    );
    const summary = formatPresenterSummary(result);
    expect(summary).toContain('FAILED');
    expect(summary).toContain('Generation failed');
  });
});

// ---- Schema Conformance ----

describe('schema conformance', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

  it('success result conforms to schema', () => {
    const result = buildDemoResult(
      makePromptMeta({ source_path: 'benchmarks/canonical-demo-prompt.json' }),
      makeGenMeta(),
      makeLoopSummary(),
      'success',
      100,
      { report: 'report.json', generated_air: 'gen.air', output_dir: '/tmp/out' },
    );
    const serialized = JSON.parse(JSON.stringify(result));
    const errors = validateJsonSchema(serialized, schema, schema);
    expect(errors).toEqual([]);
  });

  it('failure result conforms to schema', () => {
    const result = buildDemoResult(
      makePromptMeta(),
      makeGenMeta({ adapter: 'claude', model: 'claude-sonnet-4-20250514', attempts: 2, input_tokens: 500, output_tokens: 200 }),
      null,
      'missing_api_key',
      5,
      { report: 'report.json' },
      'ANTHROPIC_API_KEY not set',
    );
    const serialized = JSON.parse(JSON.stringify(result));
    const errors = validateJsonSchema(serialized, schema, schema);
    expect(errors).toEqual([]);
  });

  it('loop_failed result with partial loop conforms', () => {
    const result = buildDemoResult(
      makePromptMeta(),
      makeGenMeta({ adapter: 'claude', model: 'test' }),
      makeLoopSummary({
        stages: [
          { name: 'validate', status: 'fail', duration_ms: 5 },
          { name: 'repair', status: 'fail', duration_ms: 10 },
          { name: 'transpile', status: 'skip', duration_ms: 0 },
          { name: 'smoke', status: 'skip', duration_ms: 0 },
          { name: 'determinism', status: 'skip', duration_ms: 0 },
        ],
        repair_mode: 'deterministic',
        repair_attempts: 1,
        deterministic: false,
        file_count: 0,
        output_lines: 0,
      }),
      'loop_failed',
      2000,
      { report: 'report.json', generated_air: 'gen.air' },
      'Validation and repair both failed',
    );
    const serialized = JSON.parse(JSON.stringify(result));
    const errors = validateJsonSchema(serialized, schema, schema);
    expect(errors).toEqual([]);
  });
});

// ---- Replay Integration ----

describe('replay integration', () => {
  it('replay adapter with fullstack-todo fixture produces valid .air', async () => {
    const { createReplayAdapter } = await import('../src/generator.js');
    const adapter = createReplayAdapter();
    const result = adapter.generate('Build a fullstack todo app with database', { fixtureId: 'fullstack-todo' });
    expect(result.success).toBe(true);
    expect(result.source.length).toBeGreaterThan(0);
    expect(result.metadata.fixtureId).toBe('fullstack-todo');
  });

  it('replay adapter + loop produces success', async () => {
    const { createReplayAdapter } = await import('../src/generator.js');
    const { runLoopFromSource } = await import('../src/cli/loop.js');
    const { mkdirSync } = await import('fs');
    const { tmpdir } = await import('os');

    const adapter = createReplayAdapter();
    const genResult = adapter.generate('demo', { fixtureId: 'fullstack-todo' });
    expect(genResult.success).toBe(true);

    const tmpDir = join(tmpdir(), `demo-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const loopResult = await runLoopFromSource(genResult.source, tmpDir, {
      writeArtifacts: false,
    });

    const outcome = classifyDemoOutcome(genResult, loopResult);
    expect(outcome).toBe('success');
  });
});

// ---- Env-gated live test ----

describe('live demo (env-gated)', () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  it.skipIf(!apiKey)('claude adapter produces a demo result', async () => {
    const { createClaudeAdapter } = await import('../src/generator.js');
    const adapter = createClaudeAdapter({ apiKey: apiKey! });
    const result = await adapter.generate('Build a simple counter app with increment and decrement buttons.');
    expect(result.success).toBe(true);
    expect(result.source.length).toBeGreaterThan(0);
  }, 60000);
});
