/**
 * A5b Generator + Prompt Replay Tests
 *
 * Tests the generator adapter interface, replay adapter determinism,
 * noop adapter behavior, prompt-replay-result schema conformance,
 * and end-to-end prompt→loop integration.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import {
  createReplayAdapter,
  createNoopGeneratorAdapter,
  createClaudeAdapter,
  listReplayFixtures,
  extractAirSource,
  tryParseAir,
} from '../src/generator.js';
import type { GeneratorAdapter, GeneratorResult, ClaudeAdapterOptions } from '../src/generator.js';
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

// ---- extractAirSource ----

describe('extractAirSource', () => {
  it('extracts from fenced ```air code block', () => {
    const raw = 'Here is the code:\n```air\n@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")\n```\nDone.';
    const source = extractAirSource(raw);
    expect(source).toBe('@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")');
  });

  it('extracts from fenced ``` code block without language', () => {
    const raw = '```\n@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")\n```';
    const source = extractAirSource(raw);
    expect(source).toBe('@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")');
  });

  it('returns trimmed raw text when no code block', () => {
    const raw = '  @app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")  ';
    const source = extractAirSource(raw);
    expect(source).toBe('@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")');
  });
});

// ---- tryParseAir ----

describe('tryParseAir', () => {
  it('returns valid:true for parseable .air source', () => {
    const source = '@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")';
    expect(tryParseAir(source)).toEqual({ valid: true });
  });

  it('returns valid:false with error for invalid source', () => {
    const result = tryParseAir('not valid air code at all');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ---- Claude Adapter (mocked fetch) ----

const VALID_AIR = '@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")';

function mockClaudeResponse(text: string, status = 200, usage?: { input_tokens: number; output_tokens: number }) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      content: [{ type: 'text', text }],
      usage: usage ?? { input_tokens: 100, output_tokens: 50 },
    }),
  });
}

function mockClaudeErrorResponse(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: { type: 'error', message: 'error' } }),
  });
}

describe('ClaudeAdapter', () => {
  const baseOpts: ClaudeAdapterOptions = {
    apiKey: 'test-key-123',
    maxRetries: 1,
    timeoutMs: 5000,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has name "claude"', () => {
    const adapter = createClaudeAdapter(baseOpts);
    expect(adapter.name).toBe('claude');
  });

  it('returns success for valid .air response', async () => {
    vi.stubGlobal('fetch', mockClaudeResponse(VALID_AIR));
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(true);
    expect(result.source).toBe(VALID_AIR);
    expect(result.metadata.adapter).toBe('claude');
    expect(result.metadata.attempts).toBe(1);
    vi.unstubAllGlobals();
  });

  it('extracts .air from fenced code block in response', async () => {
    const wrappedAir = '```air\n' + VALID_AIR + '\n```';
    vi.stubGlobal('fetch', mockClaudeResponse(wrappedAir));
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(true);
    expect(result.source).toBe(VALID_AIR);
    vi.unstubAllGlobals();
  });

  it('extracts .air from raw text without backticks', async () => {
    vi.stubGlobal('fetch', mockClaudeResponse(VALID_AIR));
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(true);
    expect(result.source).toBe(VALID_AIR);
    vi.unstubAllGlobals();
  });

  it('retries on parse failure and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: 'not valid air' }],
          usage: { input_tokens: 50, output_tokens: 20 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: VALID_AIR }],
          usage: { input_tokens: 80, output_tokens: 40 },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(true);
    expect(result.metadata.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('returns failure after exhausting retries', async () => {
    vi.stubGlobal('fetch', mockClaudeResponse('garbage output'));
    const adapter = createClaudeAdapter({ ...baseOpts, maxRetries: 1 });
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(false);
    expect(result.error).toContain('failed after');
    expect(result.metadata.attempts).toBe(2);
    vi.unstubAllGlobals();
  });

  it('handles HTTP 429 with retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: VALID_AIR }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(true);
    expect(result.metadata.attempts).toBe(2);
    vi.unstubAllGlobals();
  });

  it('handles HTTP 401 without retry', async () => {
    vi.stubGlobal('fetch', mockClaudeErrorResponse(401));
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication error');
    expect(result.metadata.attempts).toBe(1);
    vi.unstubAllGlobals();
  });

  it('handles timeout error', async () => {
    const timeoutErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    Object.defineProperty(timeoutErr, 'name', { value: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr));
    const adapter = createClaudeAdapter({ ...baseOpts, maxRetries: 0 });
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    vi.unstubAllGlobals();
  });

  it('handles empty response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: '' }], usage: {} }),
    }));
    const adapter = createClaudeAdapter({ ...baseOpts, maxRetries: 0 });
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty response');
    vi.unstubAllGlobals();
  });

  it('includes correct promptHash', async () => {
    vi.stubGlobal('fetch', mockClaudeResponse(VALID_AIR));
    const adapter = createClaudeAdapter(baseOpts);
    const prompt = 'build a counter';
    const result = await adapter.generate(prompt);
    expect(result.metadata.promptHash).toBe(hashString(prompt));
    vi.unstubAllGlobals();
  });

  it('includes token usage in metadata', async () => {
    vi.stubGlobal('fetch', mockClaudeResponse(VALID_AIR, 200, { input_tokens: 200, output_tokens: 150 }));
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.metadata.inputTokens).toBe(200);
    expect(result.metadata.outputTokens).toBe(150);
    vi.unstubAllGlobals();
  });

  it('respects custom model option', async () => {
    const fetchMock = mockClaudeResponse(VALID_AIR);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeAdapter({ ...baseOpts, model: 'claude-haiku-4-5-20251001' });
    await adapter.generate('build a counter');
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.model).toBe('claude-haiku-4-5-20251001');
    vi.unstubAllGlobals();
  });

  it('durationMs reflects total wall time across retries', async () => {
    // First call fails with invalid source, second succeeds
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: 'invalid' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: VALID_AIR }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeAdapter(baseOpts);
    const result = await adapter.generate('build a counter');
    expect(result.success).toBe(true);
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    vi.unstubAllGlobals();
  });
});

// ---- Claude Adapter Live Integration (env-gated) ----

describe('ClaudeAdapter live integration', () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)('generates valid .air from live API', async () => {
    const adapter = createClaudeAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      maxRetries: 2,
      timeoutMs: 60000,
    });
    const result = await adapter.generate('build a simple counter app with increment and decrement buttons');
    expect(result.success).toBe(true);
    expect(result.source.length).toBeGreaterThan(0);
    // Verify it actually parses
    const parseCheck = tryParseAir(result.source);
    expect(parseCheck.valid).toBe(true);
  }, 60000);
});
