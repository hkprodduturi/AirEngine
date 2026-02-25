/**
 * A3e Claude Repair Adapter Tests
 *
 * All tests mock globalThis.fetch via vi.stubGlobal() — no network calls in CI.
 * 1 env-gated live test at the end.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClaudeRepairAdapter } from '../src/repair-claude.js';
import type { ClaudeRepairAdapterOptions } from '../src/repair-claude.js';
import type { Diagnostic } from '../src/diagnostics.js';
import type { RepairContext } from '../src/repair.js';
import { runLoopFromSource } from '../src/cli/loop.js';

// ---- Helpers ----

const VALID_AIR = '@app:test\n@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")';

const ERROR_DIAGS: Diagnostic[] = [
  { code: 'AIR-E001', severity: 'error', message: 'Missing @app declaration', category: 'structural' },
];

function makeBaseOpts(): ClaudeRepairAdapterOptions {
  return {
    apiKey: 'test-key-123',
    maxRetries: 1,
    timeoutMs: 5000,
  };
}

function mockFetchOk(text: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      content: [{ type: 'text', text }],
    }),
  });
}

function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: { type: 'error', message: 'error' } }),
  });
}

// ---- Tests ----

describe('ClaudeRepairAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('has name "claude"', () => {
    const adapter = createClaudeRepairAdapter(makeBaseOpts());
    expect(adapter.name).toBe('claude');
  });

  it('returns repaired for valid AIR response', async () => {
    const brokenSource = '@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")';
    vi.stubGlobal('fetch', mockFetchOk(VALID_AIR));
    const adapter = createClaudeRepairAdapter(makeBaseOpts());

    const result = await adapter.repair(brokenSource, ERROR_DIAGS);
    expect(result.status).toBe('repaired');
    expect(result.sourceChanged).toBe(true);
    expect(result.repairedSource).toBe(VALID_AIR);
    expect(result.appliedCount).toBe(1);
    expect(result.actions[0].rule).toBe('claude-repair');
    expect(result.actions[0].kind).toBe('replace');
  });

  it('extracts from fenced code block', async () => {
    const brokenSource = '@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")';
    const fencedResponse = '```air\n' + VALID_AIR + '\n```';
    vi.stubGlobal('fetch', mockFetchOk(fencedResponse));
    const adapter = createClaudeRepairAdapter(makeBaseOpts());

    const result = await adapter.repair(brokenSource, ERROR_DIAGS);
    expect(result.status).toBe('repaired');
    expect(result.repairedSource).toBe(VALID_AIR);
  });

  it('returns noop when source unchanged', async () => {
    vi.stubGlobal('fetch', mockFetchOk(VALID_AIR));
    const adapter = createClaudeRepairAdapter(makeBaseOpts());

    // Source is identical to response
    const result = await adapter.repair(VALID_AIR, ERROR_DIAGS);
    expect(result.status).toBe('noop');
    expect(result.sourceChanged).toBe(false);
  });

  it('returns partial when changed but parse-invalid', async () => {
    const brokenSource = '@state{x:int}';
    const changedButInvalid = '@app:test\n@state{x:int'; // incomplete
    vi.stubGlobal('fetch', mockFetchOk(changedButInvalid));
    const adapter = createClaudeRepairAdapter(makeBaseOpts());

    const result = await adapter.repair(brokenSource, ERROR_DIAGS);
    expect(result.status).toBe('partial');
    expect(result.sourceChanged).toBe(true);
    expect(result.repairedSource).toBe(changedButInvalid);
  });

  it('HTTP 401 fails immediately', async () => {
    const fetchMock = mockFetchError(401);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeRepairAdapter(makeBaseOpts());

    const result = await adapter.repair('@state{x:int}', ERROR_DIAGS);
    expect(result.status).toBe('failed');
    expect(result.actions[0].reason).toContain('Authentication error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 retries then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: VALID_AIR }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeRepairAdapter(makeBaseOpts());

    const result = await adapter.repair('@state{x:int}', ERROR_DIAGS);
    expect(result.status).toBe('repaired');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('timeout returns failed', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeRepairAdapter({ ...makeBaseOpts(), maxRetries: 0 });

    const result = await adapter.repair('@state{x:int}', ERROR_DIAGS);
    expect(result.status).toBe('failed');
    expect(result.actions[0].reason).toContain('timed out');
  });

  it('empty response returns failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: '' }] }),
    }));
    const adapter = createClaudeRepairAdapter({ ...makeBaseOpts(), maxRetries: 0 });

    const result = await adapter.repair('@state{x:int}', ERROR_DIAGS);
    expect(result.status).toBe('failed');
    expect(result.actions[0].reason).toContain('Empty response');
  });

  it('includes RepairContext in prompt', async () => {
    const fetchMock = mockFetchOk(VALID_AIR);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeRepairAdapter(makeBaseOpts());

    const context: RepairContext = {
      attemptNumber: 2,
      maxAttempts: 3,
      previousHashes: ['abc123'],
    };

    await adapter.repair('@state{x:int}', ERROR_DIAGS, context);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = callBody.messages[0].content;
    expect(userMessage).toContain('attempt 2 of 3');
  });

  it('respects custom model', async () => {
    const fetchMock = mockFetchOk(VALID_AIR);
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createClaudeRepairAdapter({
      ...makeBaseOpts(),
      model: 'claude-opus-4-20250514',
    });

    await adapter.repair('@state{x:int}', ERROR_DIAGS);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.model).toBe('claude-opus-4-20250514');
  });

  it('returns noop for source with no error diagnostics', async () => {
    const adapter = createClaudeRepairAdapter(makeBaseOpts());
    // No error diagnostics — should noop without calling fetch
    const result = await adapter.repair(VALID_AIR, []);
    expect(result.status).toBe('noop');
    expect(result.sourceChanged).toBe(false);
  });
});

// ---- Loop integration with mock adapter ----

describe('ClaudeRepairAdapter loop integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('repairAdapter override with mock Claude adapter stops on success', async () => {
    // Create a mock adapter that simulates Claude repair
    const mockAdapter = {
      name: 'claude',
      repair: vi.fn().mockResolvedValue({
        status: 'repaired' as const,
        originalSource: '@state{x:int}',
        repairedSource: VALID_AIR,
        sourceChanged: true,
        actions: [{
          rule: 'claude-repair',
          kind: 'replace' as const,
          text: VALID_AIR,
          description: 'Mock Claude repair',
          applied: true,
        }],
        appliedCount: 1,
        skippedCount: 0,
      }),
    };

    // Source missing @app — will trigger repair
    const source = '@state{x:int}\n@style(theme:dark)\n@ui(text>"hello")';
    const result = await runLoopFromSource(source, '.eval-tmp/claude-repair-loop', {
      writeArtifacts: false,
      repairAdapter: mockAdapter,
      maxRepairAttempts: 3,
    });

    // Repair should have been called
    expect(mockAdapter.repair).toHaveBeenCalled();

    // Repair stage should pass (repaired source is valid)
    const repairStage = result.stages.find(s => s.name === 'repair');
    expect(repairStage?.status).toBe('pass');

    // Should have repair attempts with success stop reason
    expect(result.repairAttempts).toBeDefined();
    expect(result.repairAttempts![result.repairAttempts!.length - 1].stopReason).toBe('success');
  });
});

// ---- Env-gated live test ----

describe('ClaudeRepairAdapter live', () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  it.skipIf(!apiKey)('repairs missing @app via live API', async () => {
    const adapter = createClaudeRepairAdapter({
      apiKey: apiKey!,
      maxRetries: 1,
      timeoutMs: 30000,
    });

    const brokenSource = '@state{items:[{id:int,text:str}]}\n@style(theme:dark)\n@ui(text>"hello")';
    const result = await adapter.repair(brokenSource, ERROR_DIAGS);

    // Should either repair or partial — but not failed (valid API key)
    expect(['repaired', 'partial']).toContain(result.status);
    expect(result.sourceChanged).toBe(true);

    // If repaired, it should parse
    if (result.status === 'repaired') {
      const { tryParseAir } = await import('../src/generator.js');
      expect(tryParseAir(result.repairedSource).valid).toBe(true);
    }
  }, 60000);
});
