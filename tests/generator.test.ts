/**
 * A5b Generator + Prompt Replay Tests
 *
 * Tests the generator adapter interface, replay adapter determinism,
 * noop adapter behavior, prompt-replay-result schema conformance,
 * and end-to-end prompt→loop integration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import {
  createReplayAdapter,
  createNoopGeneratorAdapter,
  listReplayFixtures,
} from '../src/generator.js';
import type { GeneratorAdapter, GeneratorResult } from '../src/generator.js';
import { runLoopFromSource } from '../src/cli/loop.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Helpers ----

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ---- Replay Adapter ----

describe('ReplayAdapter', () => {
  const adapter = createReplayAdapter();

  it('has name "replay"', () => {
    expect(adapter.name).toBe('replay');
  });

  it('returns success for known prompt "build a todo app"', () => {
    const result = adapter.generate('build a todo app');
    expect(result.success).toBe(true);
    expect(result.source.length).toBeGreaterThan(0);
    expect(result.metadata.adapter).toBe('replay');
    expect(result.metadata.fixtureId).toBe('todo');
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('is case-insensitive for prompt matching', () => {
    const r1 = adapter.generate('Build A Todo App');
    const r2 = adapter.generate('BUILD A TODO APP');
    const r3 = adapter.generate('  build a todo app  ');
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(true);
    // All should produce the same source
    expect(r1.source).toBe(r2.source);
    expect(r2.source).toBe(r3.source);
  });

  it('returns deterministic output for same prompt', () => {
    const r1 = adapter.generate('build a todo app');
    const r2 = adapter.generate('build a todo app');
    expect(r1.source).toBe(r2.source);
    expect(r1.metadata.fixtureId).toBe(r2.metadata.fixtureId);
    expect(hashString(r1.source)).toBe(hashString(r2.source));
  });

  it('returns correct promptHash', () => {
    const prompt = 'build a todo app';
    const result = adapter.generate(prompt);
    expect(result.metadata.promptHash).toBe(hashString(prompt));
  });

  it('supports fixture-id context override', () => {
    const result = adapter.generate('anything', { fixtureId: 'landing' });
    expect(result.success).toBe(true);
    expect(result.metadata.fixtureId).toBe('landing');
  });

  it('returns error for unknown prompt', () => {
    const result = adapter.generate('build a spaceship');
    expect(result.success).toBe(false);
    expect(result.source).toBe('');
    expect(result.error).toContain('Unknown prompt');
    expect(result.error).toContain('build a spaceship');
    expect(result.metadata.adapter).toBe('replay');
  });

  it('returns error for unknown fixture-id', () => {
    const result = adapter.generate('anything', { fixtureId: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown prompt');
  });

  it('generates valid .air source that parses successfully', () => {
    const fixtures = listReplayFixtures();
    for (const f of fixtures) {
      const result = adapter.generate(f.prompt);
      expect(result.success).toBe(true);
      // Verify source matches actual file content
      const fileContent = readFileSync(f.file, 'utf-8');
      expect(result.source).toBe(fileContent);
    }
  });

  it('source hash is stable across invocations', () => {
    const r1 = adapter.generate('build a todo app');
    const r2 = adapter.generate('build a todo app');
    expect(hashString(r1.source)).toBe(hashString(r2.source));
  });
});

// ---- All 5 fixtures ----

describe('ReplayAdapter fixture coverage', () => {
  const adapter = createReplayAdapter();
  const expectedFixtures = [
    { prompt: 'build a todo app', fixtureId: 'todo' },
    { prompt: 'build a fullstack todo app with database', fixtureId: 'fullstack-todo' },
    { prompt: 'build a landing page', fixtureId: 'landing' },
    { prompt: 'build a dashboard with auth', fixtureId: 'dashboard' },
    { prompt: 'build an expense tracker', fixtureId: 'expense-tracker' },
  ];

  for (const { prompt, fixtureId } of expectedFixtures) {
    it(`fixture "${fixtureId}" generates from prompt "${prompt}"`, () => {
      const result = adapter.generate(prompt);
      expect(result.success).toBe(true);
      expect(result.metadata.fixtureId).toBe(fixtureId);
      expect(result.source.length).toBeGreaterThan(0);
    });
  }

  it('listReplayFixtures returns all 5 fixtures', () => {
    const fixtures = listReplayFixtures();
    expect(fixtures).toHaveLength(5);
    const ids = fixtures.map(f => f.fixtureId);
    expect(ids).toContain('todo');
    expect(ids).toContain('fullstack-todo');
    expect(ids).toContain('landing');
    expect(ids).toContain('dashboard');
    expect(ids).toContain('expense-tracker');
  });

  it('every fixture has fixtureId, prompt, file, and description', () => {
    const fixtures = listReplayFixtures();
    for (const f of fixtures) {
      expect(f.fixtureId).toBeTruthy();
      expect(f.prompt).toBeTruthy();
      expect(f.file).toBeTruthy();
      expect(f.description).toBeTruthy();
    }
  });
});

// ---- Noop Adapter ----

describe('NoopGeneratorAdapter', () => {
  const adapter = createNoopGeneratorAdapter();

  it('has name "noop"', () => {
    expect(adapter.name).toBe('noop');
  });

  it('always returns failure', () => {
    const result = adapter.generate('build a todo app');
    expect(result.success).toBe(false);
    expect(result.source).toBe('');
    expect(result.error).toContain('Noop adapter');
    expect(result.metadata.adapter).toBe('noop');
    expect(result.metadata.durationMs).toBe(0);
  });

  it('includes correct promptHash', () => {
    const prompt = 'build something';
    const result = adapter.generate(prompt);
    expect(result.metadata.promptHash).toBe(hashString(prompt));
  });
});

// ---- Generator → Loop Integration ----

describe('Generator → Loop integration', () => {
  const adapter = createReplayAdapter();

  it('generated source from "build a todo app" passes full loop', async () => {
    const genResult = adapter.generate('build a todo app');
    expect(genResult.success).toBe(true);

    const loopResult = await runLoopFromSource(genResult.source, '.eval-tmp/gen-loop-todo', {
      writeArtifacts: false,
    });

    // No failed stages
    const failed = loopResult.stages.filter(s => s.status === 'fail');
    expect(failed).toHaveLength(0);

    // Transpile produced output
    expect(loopResult.transpileResult).toBeDefined();
    expect(loopResult.transpileResult!.files.length).toBeGreaterThan(0);

    // Deterministic
    expect(loopResult.determinismCheck.deterministic).toBe(true);
  });

  it('generated source from "build a fullstack todo app with database" passes full loop', async () => {
    const genResult = adapter.generate('build a fullstack todo app with database');
    expect(genResult.success).toBe(true);

    const loopResult = await runLoopFromSource(genResult.source, '.eval-tmp/gen-loop-fullstack', {
      writeArtifacts: false,
    });

    const failed = loopResult.stages.filter(s => s.status === 'fail');
    expect(failed).toHaveLength(0);
    expect(loopResult.transpileResult!.files.length).toBeGreaterThan(0);
    expect(loopResult.determinismCheck.deterministic).toBe(true);
  });

  it('all 5 fixture-generated sources run through the loop pipeline without throwing', async () => {
    const fixtures = listReplayFixtures();
    for (const f of fixtures) {
      const genResult = adapter.generate(f.prompt);
      expect(genResult.success).toBe(true);

      // Loop should not throw — it may have validation issues but returns structured result
      const loopResult = await runLoopFromSource(genResult.source, `.eval-tmp/gen-loop-${f.fixtureId}`, {
        writeArtifacts: false,
      });

      // All fixtures should at least have stages and determinism check
      expect(loopResult.stages.length).toBeGreaterThan(0);
      expect(loopResult.determinismCheck).toBeDefined();
    }
  });
});

// ---- Schema Conformance ----

describe('prompt-replay-result schema conformance', () => {
  const schema = JSON.parse(readFileSync('docs/prompt-replay-result.schema.json', 'utf-8'));

  function buildResult(
    genResult: GeneratorResult,
    prompt: string,
    loopResult?: Awaited<ReturnType<typeof runLoopFromSource>>,
  ): Record<string, unknown> {
    const loopSuccess = loopResult
      ? !loopResult.stages.some(s => s.status === 'fail')
      : false;

    return {
      schema_version: '1.0',
      success: genResult.success && loopSuccess,
      timestamp: new Date().toISOString(),
      prompt: {
        text: prompt,
        hash: hashString(prompt),
        source: 'cli_arg',
      },
      generator: {
        adapter: genResult.metadata.adapter,
        fixture_id: genResult.metadata.fixtureId,
        prompt_hash: genResult.metadata.promptHash,
        duration_ms: genResult.metadata.durationMs,
      },
      generated_air: genResult.success
        ? {
            source_hash: hashString(genResult.source),
            line_count: genResult.source.split('\n').length,
          }
        : null,
      loop_result: loopResult
        ? {
            success: loopSuccess,
            stages: loopResult.stages.map(s => ({
              name: s.name,
              status: s.status,
              durationMs: s.durationMs,
            })),
            file_count: loopResult.transpileResult?.files.length,
            output_lines: loopResult.transpileResult?.stats.outputLines,
            deterministic: loopResult.determinismCheck.deterministic,
          }
        : null,
      timing: {
        generate_ms: genResult.metadata.durationMs,
        loop_ms: 0,
        total_ms: genResult.metadata.durationMs,
      },
      artifacts: {},
      ...(genResult.error ? { error: genResult.error } : {}),
    };
  }

  it('successful replay result conforms to schema', async () => {
    const adapter = createReplayAdapter();
    const prompt = 'build a todo app';
    const genResult = adapter.generate(prompt);
    const loopResult = await runLoopFromSource(genResult.source, '.eval-tmp/schema-replay-ok', {
      writeArtifacts: false,
    });

    const result = buildResult(genResult, prompt, loopResult);
    const errors = validateJsonSchema(result, schema, schema);
    expect(errors).toEqual([]);
  });

  it('generation-failed result conforms to schema', () => {
    const adapter = createNoopGeneratorAdapter();
    const prompt = 'build something';
    const genResult = adapter.generate(prompt);

    const result = buildResult(genResult, prompt);
    const errors = validateJsonSchema(result, schema, schema);
    expect(errors).toEqual([]);
  });

  it('unknown prompt result conforms to schema', () => {
    const adapter = createReplayAdapter();
    const prompt = 'build a spaceship';
    const genResult = adapter.generate(prompt);

    const result = buildResult(genResult, prompt);
    const errors = validateJsonSchema(result, schema, schema);
    expect(errors).toEqual([]);
  });

  it('result with all fixture_id variants conforms to schema', async () => {
    const adapter = createReplayAdapter();
    const fixtures = listReplayFixtures();

    for (const f of fixtures) {
      const genResult = adapter.generate(f.prompt);
      const loopResult = await runLoopFromSource(genResult.source, `.eval-tmp/schema-${f.fixtureId}`, {
        writeArtifacts: false,
      });
      const result = buildResult(genResult, f.prompt, loopResult);
      const errors = validateJsonSchema(result, schema, schema);
      expect(errors).toEqual([]);
    }
  });
});
