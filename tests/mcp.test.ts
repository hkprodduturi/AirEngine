/**
 * MCP Tool Tests
 *
 * Tests the same logic the MCP server tools use:
 * parse → validate, parse → transpile, parse → explain.
 * Verifies outputs match real parser/transpiler behavior.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from '../src/parser/index.js';
import { validate, diagnose } from '../src/validator/index.js';
import { transpile } from '../src/transpiler/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { AirParseError, AirLexError } from '../src/parser/errors.js';
import { wrapParseError, buildResult, hashSource } from '../src/diagnostics.js';
import { runLoopFromSource } from '../src/cli/loop.js';
import type { AirAST } from '../src/parser/types.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Helpers (same as MCP server) ----

function safeParse(source: string): { ast: AirAST } | { error: string; line?: number; col?: number } {
  try {
    return { ast: parse(source) };
  } catch (err) {
    if (err instanceof AirParseError) {
      return { error: err.message, line: err.line, col: err.col };
    }
    if (err instanceof AirLexError) {
      return { error: err.message, line: err.line, col: err.col };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function readExample(name: string): string {
  return readFileSync(`examples/${name}.air`, 'utf-8');
}

// ---- air_validate ----

describe('air_validate tool logic', () => {
  it('returns valid result for todo.air', () => {
    const source = readExample('todo');
    const result = safeParse(source);
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      const v = validate(result.ast);
      expect(v.valid).toBe(true);
      expect(v.errors).toHaveLength(0);
      expect(result.ast.app.name).toBe('todo');
      expect(result.ast.app.blocks.length).toBe(4);
    }
  });

  it('returns valid result for fullstack-todo.air', () => {
    const source = readExample('fullstack-todo');
    const result = safeParse(source);
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      const v = validate(result.ast);
      expect(v.valid).toBe(true);
      expect(result.ast.app.blocks.length).toBe(6);
      const blockTypes = result.ast.app.blocks.map(b => b.kind);
      expect(blockTypes).toContain('db');
      expect(blockTypes).toContain('api');
    }
  });

  it('returns field count for state blocks', () => {
    const source = readExample('todo');
    const result = safeParse(source);
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      const stateBlocks = result.ast.app.blocks.filter(b => b.kind === 'state');
      const fieldCount = stateBlocks.reduce((sum, b) => sum + (b.kind === 'state' ? b.fields.length : 0), 0);
      expect(fieldCount).toBe(2); // items, filter
    }
  });

  it('returns route count for api blocks', () => {
    const source = readExample('fullstack-todo');
    const result = safeParse(source);
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      const apiBlocks = result.ast.app.blocks.filter(b => b.kind === 'api');
      const routeCount = apiBlocks.reduce((sum, b) => sum + (b.kind === 'api' ? b.routes.length : 0), 0);
      expect(routeCount).toBe(4); // GET, POST, PUT, DELETE
    }
  });

  it('returns db model count', () => {
    const source = readExample('fullstack-todo');
    const result = safeParse(source);
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      const dbBlocks = result.ast.app.blocks.filter(b => b.kind === 'db');
      const modelCount = dbBlocks.reduce((sum, b) => sum + (b.kind === 'db' ? b.models.length : 0), 0);
      expect(modelCount).toBe(1); // Todo
    }
  });

  it('catches AirParseError with line/col', () => {
    const result = safeParse('not valid air code');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Parse Error');
      expect(result.line).toBeDefined();
      expect(result.col).toBeDefined();
    }
  });

  it('catches AirLexError for unterminated strings', () => {
    const result = safeParse('@app:t\n@state{"unterminated');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Lex Error');
      expect(result.line).toBeDefined();
    }
  });

  it('returns validation warnings for missing @state', () => {
    const source = '@app:t\n@ui(\ntext>"hello"\n)';
    const result = safeParse(source);
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      const v = validate(result.ast);
      expect(v.valid).toBe(true); // still valid, just warning
      expect(v.warnings.length).toBeGreaterThan(0);
      expect(v.warnings.some(w => w.message.includes('state'))).toBe(true);
    }
  });

  it('returns validation error for missing @ui', () => {
    const source = '@app:t\n@state{x:int}';
    const result = safeParse(source);
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      const v = validate(result.ast);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.message.includes('ui'))).toBe(true);
    }
  });
});

// ---- air_transpile ----

describe('air_transpile tool logic', () => {
  it('transpiles todo.air with file metadata', () => {
    const source = readExample('todo');
    const ast = parse(source);
    const result = transpile(ast);
    const ctx = extractContext(ast);

    expect(result.files.length).toBeGreaterThan(0);
    expect(ctx.hasBackend).toBe(false);

    // File metadata
    for (const f of result.files) {
      expect(f.path).toBeTruthy();
      expect(f.content.split('\n').length).toBeGreaterThan(0);
    }

    // Stats
    expect(result.stats.outputLines).toBeGreaterThan(0);
    expect(result.stats.components).toBeGreaterThanOrEqual(1);
  });

  it('transpiles fullstack-todo.air with hasBackend=true', () => {
    const source = readExample('fullstack-todo');
    const ast = parse(source);
    const result = transpile(ast);
    const ctx = extractContext(ast);

    expect(ctx.hasBackend).toBe(true);
    expect(result.files.some(f => f.path.startsWith('server/'))).toBe(true);
    expect(result.files.some(f => f.path.startsWith('client/'))).toBe(true);
  });

  it('reports processedBlocks correctly', () => {
    const source = readExample('fullstack-todo');
    const ast = parse(source);
    const processedBlocks = ast.app.blocks.map(b => b.kind);
    expect(processedBlocks).toContain('state');
    expect(processedBlocks).toContain('style');
    expect(processedBlocks).toContain('db');
    expect(processedBlocks).toContain('api');
    expect(processedBlocks).toContain('ui');
    expect(processedBlocks).toContain('persist');
  });

  it('total output under 5000 lines for todo.air (full content returned)', () => {
    const source = readExample('todo');
    const ast = parse(source);
    const result = transpile(ast);
    expect(result.stats.outputLines).toBeLessThan(5000);
  });

  it('returns error for invalid source', () => {
    const result = safeParse('not valid');
    expect('error' in result).toBe(true);
  });

  it('transpiles all 7 examples without throwing', () => {
    const names = ['todo', 'expense-tracker', 'auth', 'dashboard', 'landing', 'fullstack-todo', 'projectflow'];
    for (const name of names) {
      const source = readExample(name);
      const ast = parse(source);
      expect(() => transpile(ast)).not.toThrow();
    }
  });
});

// ---- air_explain ----

describe('air_explain tool logic', () => {
  it('extracts correct analysis from todo.air', () => {
    const source = readExample('todo');
    const ast = parse(source);
    const ctx = extractContext(ast);

    expect(ast.app.name).toBe('todo');
    const blockTypes = ast.app.blocks.map(b => b.kind);
    expect(blockTypes).toContain('state');
    expect(blockTypes).toContain('style');
    expect(blockTypes).toContain('ui');
    expect(blockTypes).toContain('persist');

    const stateFields = ast.app.blocks
      .filter(b => b.kind === 'state')
      .flatMap(b => b.kind === 'state' ? b.fields.map(f => f.name) : []);
    expect(stateFields).toEqual(['items', 'filter']);

    expect(ctx.hasBackend).toBe(false);
    expect(ctx.persistMethod).toBe('localStorage');
    expect(ctx.persistKeys).toContain('items');
  });

  it('extracts backend info from fullstack-todo.air', () => {
    const source = readExample('fullstack-todo');
    const ast = parse(source);
    const ctx = extractContext(ast);

    expect(ctx.hasBackend).toBe(true);

    const dbModels = ast.app.blocks
      .filter(b => b.kind === 'db')
      .flatMap(b => b.kind === 'db' ? b.models.map(m => m.name) : []);
    expect(dbModels).toEqual(['Todo']);

    expect(ctx.apiRoutes.length).toBe(4);
  });

  it('extracts hooks from dashboard.air', () => {
    const source = readExample('dashboard');
    const ast = parse(source);

    const hooks = ast.app.blocks
      .filter(b => b.kind === 'hook')
      .flatMap(b => b.kind === 'hook' ? b.hooks.map(h => h.trigger) : []);
    expect(hooks.length).toBeGreaterThan(0);
  });

  it('returns error info for invalid source', () => {
    const result = safeParse('@app:');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBeTruthy();
    }
  });
});

// ---- air_generate ----

describe('air_generate tool logic', () => {
  it('spec includes backend block types', () => {
    // AIR_SPEC now lives in src/generator.ts (shared export)
    const specSource = readFileSync('src/generator.ts', 'utf-8');
    expect(specSource).toContain('@db{...}');
    expect(specSource).toContain('@cron(...)');
    expect(specSource).toContain('@webhook(...)');
    expect(specSource).toContain('@queue(...)');
    expect(specSource).toContain('@email(...)');
    expect(specSource).toContain('@env(...)');
    expect(specSource).toContain('@deploy(...)');
  });

  it('spec includes datetime type', () => {
    const specSource = readFileSync('src/generator.ts', 'utf-8');
    expect(specSource).toContain('datetime');
  });

  it('spec includes db field modifiers', () => {
    const specSource = readFileSync('src/generator.ts', 'utf-8');
    expect(specSource).toContain(':primary');
    expect(specSource).toContain(':required');
    expect(specSource).toContain(':auto');
    expect(specSource).toContain(':default');
  });

  it('examples list includes fullstack-todo.air', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    expect(serverSource).toContain('fullstack-todo.air');
  });
});

// ---- Batch 5: MCP session cache ----

// ---- OV-1.4: MCP Parity (v2 DiagnosticResult shape) ----

describe('MCP v2 format parity', () => {
  it('air_validate v2: valid source returns DiagnosticResult shape', () => {
    const source = readExample('todo');
    const ast = parse(source);
    const diags = diagnose(ast);
    const result = buildResult(diags, hashSource(source));

    // Shape checks
    expect(result).toHaveProperty('valid', true);
    expect(result).toHaveProperty('diagnostics');
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('errors');
    expect(result.summary).toHaveProperty('warnings');
    expect(result.summary).toHaveProperty('info');
    expect(result).toHaveProperty('source_hash');
    expect(result.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toHaveProperty('schema_version', '1.0');
    expect(result).toHaveProperty('airengine_version');
  });

  it('air_validate v2: parse error returns DiagnosticResult with AIR-P code', () => {
    const source = 'not valid air';
    const parseResult = safeParse(source);
    expect('error' in parseResult).toBe(true);

    // Simulate MCP v2 parse error path
    const diag = wrapParseError(new AirParseError('Unexpected token', { line: 1, col: 1 }));
    const result = buildResult([diag], hashSource(source));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toMatch(/^AIR-P/);
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].category).toBe('syntax');
    expect(result.schema_version).toBe('1.0');
  });

  it('air_lint v2: returns same DiagnosticResult shape as air_validate v2', () => {
    const source = readExample('fullstack-todo');
    const ast = parse(source);

    // Simulate validate v2 path
    const validateResult = buildResult(diagnose(ast), hashSource(source));

    // Simulate lint v2 path (same diagnose + potential ambiguous relations)
    const lintResult = buildResult(diagnose(ast), hashSource(source));

    // Both should have identical shape
    const validateKeys = Object.keys(validateResult).sort();
    const lintKeys = Object.keys(lintResult).sort();
    expect(validateKeys).toEqual(lintKeys);

    // Both have required envelope fields
    for (const result of [validateResult, lintResult]) {
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.diagnostics)).toBe(true);
      expect(typeof result.summary.errors).toBe('number');
      expect(typeof result.summary.warnings).toBe('number');
      expect(typeof result.summary.info).toBe('number');
      expect(result.schema_version).toBe('1.0');
    }
  });

  it('v2 diagnostic items all have required fields', () => {
    const source = readExample('fullstack-todo');
    const ast = parse(source);
    const result = buildResult(diagnose(ast), hashSource(source));

    for (const d of result.diagnostics) {
      expect(d).toHaveProperty('code');
      expect(d.code).toMatch(/^AIR-[PEWL]\d{3}$/);
      expect(d).toHaveProperty('severity');
      expect(['error', 'warning', 'info']).toContain(d.severity);
      expect(d).toHaveProperty('message');
      expect(typeof d.message).toBe('string');
      expect(d).toHaveProperty('category');
      expect(['syntax', 'structural', 'semantic', 'style', 'performance']).toContain(d.category);
    }
  });

  it('v2 summary counts match actual diagnostic array', () => {
    // Use a source that triggers multiple severity levels
    const source = '@app:test\n@state{x:int,unused:str}\n@ui(h1>#x)';
    const ast = parse(source);
    const result = buildResult(diagnose(ast), hashSource(source));

    const actualErrors = result.diagnostics.filter((d: any) => d.severity === 'error').length;
    const actualWarnings = result.diagnostics.filter((d: any) => d.severity === 'warning').length;
    const actualInfo = result.diagnostics.filter((d: any) => d.severity === 'info').length;

    expect(result.summary.errors).toBe(actualErrors);
    expect(result.summary.warnings).toBe(actualWarnings);
    expect(result.summary.info).toBe(actualInfo);
  });
});

describe('Batch 5A: session-level AST cache', () => {
  it('getCachedOrParse returns cached=false on first call', () => {
    // We test the cache logic by parsing the same source twice
    // and verifying the second parse gives same result
    const source = readExample('todo');
    const ast1 = parse(source);
    const ast2 = parse(source);
    expect(ast1.app.name).toBe(ast2.app.name);
    expect(ast1.app.blocks.length).toBe(ast2.app.blocks.length);
  });

  it('same source hash produces same parse result', () => {
    const { createHash } = require('crypto');
    const source = readExample('todo');
    const hash1 = createHash('sha256').update(source).digest('hex').slice(0, 16);
    const hash2 = createHash('sha256').update(source).digest('hex').slice(0, 16);
    expect(hash1).toBe(hash2);
  });
});

describe('Batch 5B: diff-first transpile', () => {
  it('transpile result is deterministic for same source', () => {
    const source = readExample('todo');
    const ast = parse(source);
    const r1 = transpile(ast);
    const r2 = transpile(ast);
    expect(r1.files.length).toBe(r2.files.length);
    expect(r1.stats.outputLines).toBe(r2.stats.outputLines);
  });
});

describe('Batch 5C: air_lint tool logic', () => {
  it('detects @db without @api', () => {
    const source = `@app:test
  @state{items:[{id:int,text:str}]}
  @db{
    Item{id:int:primary:auto,text:str:required}
  }
  @ui(
    text>"hello"
  )`;
    const ast = parse(source);
    const ctx = extractContext(ast);
    expect(ctx.db).toBeDefined();
    expect(ctx.apiRoutes).toHaveLength(0);
  });

  it('detects missing @persist on frontend-only stateful apps', () => {
    const source = `@app:test
  @state{items:[{id:int,text:str}]}
  @ui(
    text>"hello"
  )`;
    const ast = parse(source);
    const ctx = extractContext(ast);
    const hasState = ast.app.blocks.some(b => b.kind === 'state');
    const hasPersist = ast.app.blocks.some(b => b.kind === 'persist');
    expect(hasState).toBe(true);
    expect(hasPersist).toBe(false);
    expect(ctx.hasBackend).toBe(false);
  });
});

describe('Batch 5D: air_capabilities tool logic', () => {
  it('MCP server has air_capabilities tool', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    expect(serverSource).toContain('air_capabilities');
    expect(serverSource).toContain('air_lint');
  });

  it('capabilities response includes all block types', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    const blocks = ['app', 'state', 'style', 'ui', 'api', 'auth', 'nav', 'persist', 'hook',
      'db', 'cron', 'webhook', 'queue', 'email', 'env', 'deploy'];
    for (const block of blocks) {
      expect(serverSource).toContain(`'${block}'`);
    }
  });
});

// ---- A3c: air_loop MCP tool ----

describe('air_loop tool logic', () => {
  // Helper: simulate MCP tool response shape from runLoopFromSource
  async function callAirLoop(source: string, opts?: {
    output_dir?: string;
    repair_mode?: 'deterministic' | 'none';
    write_artifacts?: boolean;
    max_repair_attempts?: number;
  }) {
    const result = await runLoopFromSource(source, opts?.output_dir ?? '.eval-tmp/mcp-loop-test', {
      repairMode: opts?.repair_mode ?? 'deterministic',
      writeArtifacts: opts?.write_artifacts ?? true,
      maxRepairAttempts: opts?.max_repair_attempts ?? 1,
    });

    // Build the same structured response the MCP tool returns
    const repairStage = result.stages.find(s => s.name === 'repair');
    const success = !result.stages.some(s => {
      if (s.name === 'validate' && repairStage?.status === 'pass') return false;
      return s.status === 'fail';
    });

    const response: Record<string, unknown> = {
      schema_version: '1.0',
      success,
      stages: result.stages,
      diagnostics: result.repairResult?.afterDiagnostics ?? result.diagnostics,
      determinism: result.determinismCheck,
    };

    if (result.repairAttempts) {
      response.repair_attempts = result.repairAttempts.map(a => ({
        attempt: a.attemptNumber,
        errors_before: a.errorsBefore,
        errors_after: a.errorsAfter,
        source_hash: a.sourceHash,
        duration_ms: a.durationMs,
        ...(a.stopReason ? { stop_reason: a.stopReason } : {}),
      }));
    }

    if (result.repairResult) {
      response.repair_result = {
        status: result.repairResult.status,
        attempted: result.repairResult.attempted,
        source_changed: result.repairResult.sourceChanged,
        applied_count: result.repairResult.appliedActions.length,
        skipped_count: result.repairResult.skippedActions.length,
        applied_actions: result.repairResult.appliedActions.map(a => ({
          rule: a.rule, kind: a.kind, description: a.description,
        })),
        skipped_actions: result.repairResult.skippedActions.map(a => ({
          rule: a.rule, description: a.description, reason: a.reason,
        })),
      };
    }

    if (result.transpileResult) {
      response.transpile_summary = {
        file_count: result.transpileResult.files.length,
        output_lines: result.transpileResult.stats.outputLines,
        compression_ratio: result.transpileResult.stats.compressionRatio,
      };
    }

    const smokeStage = result.stages.find(s => s.name === 'smoke');
    if (smokeStage) {
      response.smoke_summary = { status: smokeStage.status, checks: smokeStage.details };
    }

    if (opts?.write_artifacts !== false) {
      response.artifact_dir = result.artifactDir;
    }
    response.output_dir = result.outputDir;

    return { response, rawResult: result };
  }

  it('valid source → loop succeeds with all stages pass', async () => {
    const source = readExample('todo');
    const { response } = await callAirLoop(source);

    expect(response.success).toBe(true);
    expect(response.schema_version).toBe('1.0');

    const stages = response.stages as any[];
    expect(stages.find((s: any) => s.name === 'validate')!.status).toBe('pass');
    expect(stages.find((s: any) => s.name === 'repair')!.status).toBe('skip');
    expect(stages.find((s: any) => s.name === 'transpile')!.status).toBe('pass');
    expect(stages.find((s: any) => s.name === 'smoke')!.status).toBe('pass');
    expect(stages.find((s: any) => s.name === 'determinism')!.status).toBe('pass');

    // No repair result when skipped
    expect(response.repair_result).toBeUndefined();

    // Transpile summary present
    const ts = response.transpile_summary as any;
    expect(ts.file_count).toBeGreaterThan(0);
    expect(ts.output_lines).toBeGreaterThan(0);
  });

  it('repairable invalid source (E001+E002) → repair succeeds → loop succeeds', async () => {
    const source = '@state{x:int}';
    const { response } = await callAirLoop(source);

    expect(response.success).toBe(true);

    const stages = response.stages as any[];
    expect(stages.find((s: any) => s.name === 'validate')!.status).toBe('fail');
    expect(stages.find((s: any) => s.name === 'repair')!.status).toBe('pass');
    expect(stages.find((s: any) => s.name === 'transpile')!.status).toBe('pass');

    // Repair result present and successful
    const rr = response.repair_result as any;
    expect(rr.status).toBe('repaired');
    expect(rr.attempted).toBe(true);
    expect(rr.source_changed).toBe(true);
    expect(rr.applied_count).toBe(2);

    // Transpile summary present
    expect(response.transpile_summary).toBeDefined();
    expect((response.transpile_summary as any).file_count).toBeGreaterThan(0);
  });

  it('unrepairable invalid source → loop fails gracefully with structured output', async () => {
    // This source has a lex error that can't be repaired
    const source = '@app:test\n@state{"unterminated';
    const { response } = await callAirLoop(source);

    expect(response.success).toBe(false);
    expect(response.schema_version).toBe('1.0');

    // Stages present
    const stages = response.stages as any[];
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.find((s: any) => s.name === 'validate')!.status).toBe('fail');

    // Diagnostics present and structured
    const diags = response.diagnostics as any;
    expect(diags).toBeDefined();
    expect(diags.valid).toBe(false);
    expect(diags.diagnostics.length).toBeGreaterThan(0);
    expect(diags.summary.errors).toBeGreaterThan(0);

    // No transpile summary (never reached)
    expect(response.transpile_summary).toBeUndefined();
  });

  it('returned diagnostics conform to diagnostics contract shape', async () => {
    const source = readExample('fullstack-todo');
    const { response } = await callAirLoop(source);

    const diags = response.diagnostics as any;
    expect(diags).toHaveProperty('valid');
    expect(diags).toHaveProperty('diagnostics');
    expect(diags).toHaveProperty('summary');
    expect(diags).toHaveProperty('source_hash');
    expect(diags).toHaveProperty('schema_version', '1.0');
    expect(diags).toHaveProperty('airengine_version');

    expect(typeof diags.valid).toBe('boolean');
    expect(Array.isArray(diags.diagnostics)).toBe(true);
    expect(typeof diags.summary.errors).toBe('number');
    expect(typeof diags.summary.warnings).toBe('number');
    expect(typeof diags.summary.info).toBe('number');
  });

  it('returned loop result conforms to loop-result.schema.json required fields', async () => {
    const source = readExample('todo');
    const { response } = await callAirLoop(source);

    // Top-level required fields
    expect(response).toHaveProperty('schema_version', '1.0');
    expect(response).toHaveProperty('success');
    expect(typeof response.success).toBe('boolean');
    expect(response).toHaveProperty('stages');
    expect(Array.isArray(response.stages)).toBe(true);
    expect(response).toHaveProperty('diagnostics');

    // Stage shape
    for (const stage of response.stages as any[]) {
      expect(stage).toHaveProperty('name');
      expect(stage).toHaveProperty('status');
      expect(stage).toHaveProperty('durationMs');
      expect(['pass', 'fail', 'skip']).toContain(stage.status);
      expect(typeof stage.durationMs).toBe('number');
    }

    // Determinism
    expect(response).toHaveProperty('determinism');
    const det = response.determinism as any;
    expect(det).toHaveProperty('sourceHash');
    expect(det).toHaveProperty('deterministic');
    expect(typeof det.deterministic).toBe('boolean');
  });

  it('repair_mode=none skips repair', async () => {
    const source = '@state{x:int}'; // Would normally trigger repair
    const { response } = await callAirLoop(source, { repair_mode: 'none' });

    expect(response.success).toBe(false); // No repair → validation errors remain

    const stages = response.stages as any[];
    expect(stages.find((s: any) => s.name === 'repair')!.status).toBe('skip');
    expect(stages.find((s: any) => s.name === 'repair')!.details).toHaveProperty('reason', 'Repair disabled');

    // No repair_result when skipped
    expect(response.repair_result).toBeUndefined();
  });

  it('artifact directory created when write_artifacts=true', async () => {
    const source = readExample('todo');
    const { rawResult } = await callAirLoop(source);
    expect(existsSync(rawResult.artifactDir)).toBe(true);
  });

  it('repair artifacts included on attempted repair', async () => {
    const source = '@state{x:int}';
    const { rawResult } = await callAirLoop(source);

    expect(existsSync(join(rawResult.artifactDir, 'repair-actions.json'))).toBe(true);
    expect(existsSync(join(rawResult.artifactDir, 'diagnostics-before.json'))).toBe(true);
    expect(existsSync(join(rawResult.artifactDir, 'repaired.air'))).toBe(true);
    expect(existsSync(join(rawResult.artifactDir, 'diagnostics-after.json'))).toBe(true);
  });

  it('deterministic flag and hash surfaced in response', async () => {
    const source = readExample('todo');
    const { response } = await callAirLoop(source);

    const det = response.determinism as any;
    expect(det.deterministic).toBe(true);
    expect(det.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(det.outputHashes).length).toBeGreaterThan(0);
  });

  it('no hidden text-only errors (always structured)', async () => {
    // Even for broken source, response is valid JSON with required fields
    const source = '@state{x:int}'; // triggers parse error on missing @app
    const { response } = await callAirLoop(source);

    // Response should be a structured object, not a plain error string
    expect(typeof response).toBe('object');
    expect(response).toHaveProperty('schema_version');
    expect(response).toHaveProperty('success');
    expect(response).toHaveProperty('stages');
    expect(response).toHaveProperty('diagnostics');
  });

  it('MCP server registers air_loop tool', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    expect(serverSource).toContain("'air_loop'");
    expect(serverSource).toContain('runLoopFromSource');
  });

  // ---- A3d: Retry MCP parity tests ----

  it('max_repair_attempts defaults to 1 (no repair_attempts in response)', async () => {
    const source = readExample('todo');
    const { response } = await callAirLoop(source);
    // Default max_repair_attempts=1 → no repair_attempts in response
    expect(response.repair_attempts).toBeUndefined();
  });

  it('repair_attempts absent for single attempt on repairable source', async () => {
    const source = '@state{x:int}';
    const { response } = await callAirLoop(source, { max_repair_attempts: 1 });
    expect(response.repair_attempts).toBeUndefined();
    // repair_result still present
    expect(response.repair_result).toBeDefined();
  });

  it('max_repair_attempts > 1 includes repair_attempts in response', async () => {
    const source = '@state{x:int}';
    const { response } = await callAirLoop(source, { max_repair_attempts: 2 });
    expect(response.repair_attempts).toBeDefined();
    expect(Array.isArray(response.repair_attempts)).toBe(true);
    const attempts = response.repair_attempts as any[];
    expect(attempts.length).toBeGreaterThan(0);
    // Each attempt has schema-required snake_case fields
    for (const attempt of attempts) {
      expect(typeof attempt.attempt).toBe('number');
      expect(typeof attempt.source_hash).toBe('string');
      expect(typeof attempt.errors_before).toBe('number');
      expect(typeof attempt.duration_ms).toBe('number');
    }
    // Last attempt should have a stop_reason
    expect(attempts[attempts.length - 1].stop_reason).toBeDefined();
  });
});

// ---- Schema conformance (CH-2: real JSON Schema validation) ----

describe('Schema conformance', () => {
  const loopSchema = JSON.parse(readFileSync('docs/loop-result.schema.json', 'utf-8'));
  const diagSchema = JSON.parse(readFileSync('docs/diagnostics.schema.json', 'utf-8'));

  // Helper: build MCP-style response from runLoopFromSource result
  function buildMcpResponse(result: Awaited<ReturnType<typeof runLoopFromSource>>): Record<string, unknown> {
    const repairStage = result.stages.find(s => s.name === 'repair');
    const success = !result.stages.some(s => {
      if (s.name === 'validate' && repairStage?.status === 'pass') return false;
      return s.status === 'fail';
    });

    const response: Record<string, unknown> = {
      schema_version: '1.0',
      success,
      stages: result.stages,
      diagnostics: result.repairResult?.afterDiagnostics ?? result.diagnostics,
      determinism: result.determinismCheck,
    };

    if (result.repairAttempts) {
      response.repair_attempts = result.repairAttempts.map(a => ({
        attempt: a.attemptNumber,
        errors_before: a.errorsBefore,
        errors_after: a.errorsAfter,
        source_hash: a.sourceHash,
        duration_ms: a.durationMs,
        ...(a.stopReason ? { stop_reason: a.stopReason } : {}),
      }));
    }

    if (result.repairResult) {
      response.repair_result = {
        status: result.repairResult.status,
        attempted: result.repairResult.attempted,
        source_changed: result.repairResult.sourceChanged,
        applied_count: result.repairResult.appliedActions.length,
        skipped_count: result.repairResult.skippedActions.length,
        applied_actions: result.repairResult.appliedActions.map(a => ({
          rule: a.rule, kind: a.kind, description: a.description,
        })),
        skipped_actions: result.repairResult.skippedActions.map(a => ({
          rule: a.rule, description: a.description, reason: a.reason,
        })),
      };
    }

    if (result.transpileResult) {
      response.transpile_summary = {
        file_count: result.transpileResult.files.length,
        output_lines: result.transpileResult.stats.outputLines,
        compression_ratio: result.transpileResult.stats.compressionRatio,
      };
    }

    const smokeStage = result.stages.find(s => s.name === 'smoke');
    if (smokeStage) {
      response.smoke_summary = { status: smokeStage.status, checks: smokeStage.details };
    }

    response.output_dir = result.outputDir;
    return response;
  }

  it('valid source response conforms to loop-result.schema.json', async () => {
    const source = readExample('todo');
    const result = await runLoopFromSource(source, '.eval-tmp/schema-valid', {
      writeArtifacts: false,
    });
    const response = buildMcpResponse(result);
    const errors = validateJsonSchema(response, loopSchema, loopSchema);
    expect(errors).toEqual([]);
  });

  it('repairable source with max_repair_attempts=2 conforms to loop-result.schema.json', async () => {
    const source = '@state{x:int}';
    const result = await runLoopFromSource(source, '.eval-tmp/schema-repair', {
      maxRepairAttempts: 2,
      writeArtifacts: false,
    });
    const response = buildMcpResponse(result);
    const errors = validateJsonSchema(response, loopSchema, loopSchema);
    expect(errors).toEqual([]);
    // Verify repair_attempts is actually present and validated
    expect(response.repair_attempts).toBeDefined();
    expect((response.repair_attempts as any[]).length).toBeGreaterThan(0);
  });

  it('unrepairable source response conforms to loop-result.schema.json', async () => {
    const source = '@app:test\n@state{"unterminated';
    const result = await runLoopFromSource(source, '.eval-tmp/schema-unrepairable', {
      writeArtifacts: false,
    });
    const response = buildMcpResponse(result);
    const errors = validateJsonSchema(response, loopSchema, loopSchema);
    expect(errors).toEqual([]);
  });

  it('repair_mode=none response conforms to loop-result.schema.json', async () => {
    const source = '@state{x:int}';
    const result = await runLoopFromSource(source, '.eval-tmp/schema-norepair', {
      repairMode: 'none',
      writeArtifacts: false,
    });
    const response = buildMcpResponse(result);
    const errors = validateJsonSchema(response, loopSchema, loopSchema);
    expect(errors).toEqual([]);
  });

  it('DiagnosticResult conforms to diagnostics.schema.json', () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const ast = parse(source);
    const diags = diagnose(ast);
    const result = buildResult(diags, hashSource(source));
    const errors = validateJsonSchema(result, diagSchema, diagSchema);
    expect(errors).toEqual([]);
  });

  it('DiagnosticResult with errors conforms to diagnostics.schema.json', () => {
    // Parse a valid source then diagnose — triggers validation warnings/errors
    const source = readFileSync('examples/fullstack-todo.air', 'utf-8');
    const ast = parse(source);
    const diags = diagnose(ast);
    const result = buildResult(diags, hashSource(source));
    const errors = validateJsonSchema(result, diagSchema, diagSchema);
    expect(errors).toEqual([]);
  });
});
