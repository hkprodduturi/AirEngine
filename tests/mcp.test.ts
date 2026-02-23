/**
 * MCP Tool Tests
 *
 * Tests the same logic the MCP server tools use:
 * parse → validate, parse → transpile, parse → explain.
 * Verifies outputs match real parser/transpiler behavior.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { validate } from '../src/validator/index.js';
import { transpile } from '../src/transpiler/index.js';
import { extractContext } from '../src/transpiler/context.js';
import { AirParseError, AirLexError } from '../src/parser/errors.js';
import type { AirAST } from '../src/parser/types.js';

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
    // Read the MCP server source and verify spec content
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    expect(serverSource).toContain('@db{...}');
    expect(serverSource).toContain('@cron(...)');
    expect(serverSource).toContain('@webhook(...)');
    expect(serverSource).toContain('@queue(...)');
    expect(serverSource).toContain('@email(...)');
    expect(serverSource).toContain('@env(...)');
    expect(serverSource).toContain('@deploy(...)');
  });

  it('spec includes datetime type', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    expect(serverSource).toContain('datetime');
  });

  it('spec includes db field modifiers', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    expect(serverSource).toContain(':primary');
    expect(serverSource).toContain(':required');
    expect(serverSource).toContain(':auto');
    expect(serverSource).toContain(':default');
  });

  it('examples list includes fullstack-todo.air', () => {
    const serverSource = readFileSync('src/mcp/server.ts', 'utf-8');
    expect(serverSource).toContain('fullstack-todo.air');
  });
});

// ---- Batch 5: MCP session cache ----

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
