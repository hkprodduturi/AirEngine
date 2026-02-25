import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.js';
import { validate, diagnose } from '../src/validator/index.js';
import { AirParseError, AirLexError } from '../src/parser/errors.js';
import {
  createDiagnostic,
  wrapParseError,
  sortDiagnostics,
  buildResult,
  hashSource,
  toLegacyFormat,
  formatDiagnosticCLI,
  SCHEMA_VERSION,
} from '../src/diagnostics.js';
import type { Diagnostic, DiagnosticResult } from '../src/diagnostics.js';

// ---- DiagnosticResult Schema Shape ----

describe('DiagnosticResult schema shape', () => {
  it('buildResult produces all required fields', () => {
    const result = buildResult([], hashSource('@app:test\n@state{x:int}\n@ui(h1>"hi")'));
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('diagnostics');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('source_hash');
    expect(result).toHaveProperty('airengine_version');
    expect(result).toHaveProperty('schema_version');
    expect(result.schema_version).toBe('1.0');
    expect(result.valid).toBe(true);
    expect(result.summary).toEqual({ errors: 0, warnings: 0, info: 0 });
  });

  it('schema_version is current SCHEMA_VERSION constant', () => {
    expect(SCHEMA_VERSION).toBe('1.0');
    const result = buildResult([], 'abc');
    expect(result.schema_version).toBe(SCHEMA_VERSION);
  });

  it('source_hash is a SHA-256 hex string', () => {
    const hash = hashSource('hello');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('airengine_version is present and non-empty', () => {
    const result = buildResult([], 'abc');
    expect(result.airengine_version).toBeTruthy();
    expect(typeof result.airengine_version).toBe('string');
  });
});

// ---- Deterministic Ordering ----

describe('deterministic ordering', () => {
  it('same input produces same output ordering', () => {
    const diags: Diagnostic[] = [
      createDiagnostic('AIR-W001', 'warning', 'No state', 'structural'),
      createDiagnostic('AIR-E002', 'error', 'No UI', 'structural'),
      createDiagnostic('AIR-L001', 'info', 'No persist', 'style'),
      createDiagnostic('AIR-E001', 'error', 'No name', 'structural'),
    ];
    const sorted = sortDiagnostics(diags);
    // Errors first, then warnings, then info
    expect(sorted[0].severity).toBe('error');
    expect(sorted[1].severity).toBe('error');
    expect(sorted[2].severity).toBe('warning');
    expect(sorted[3].severity).toBe('info');
  });

  it('errors without location sorted by code', () => {
    const diags: Diagnostic[] = [
      createDiagnostic('AIR-E002', 'error', 'B', 'structural'),
      createDiagnostic('AIR-E001', 'error', 'A', 'structural'),
    ];
    const sorted = sortDiagnostics(diags);
    expect(sorted[0].code).toBe('AIR-E001');
    expect(sorted[1].code).toBe('AIR-E002');
  });

  it('errors with location sorted by line then code', () => {
    const diags: Diagnostic[] = [
      createDiagnostic('AIR-E002', 'error', 'B', 'structural', { location: { line: 5, col: 1 } }),
      createDiagnostic('AIR-E001', 'error', 'A', 'structural', { location: { line: 2, col: 1 } }),
      createDiagnostic('AIR-E003', 'error', 'C', 'structural', { location: { line: 2, col: 3 } }),
    ];
    const sorted = sortDiagnostics(diags);
    expect(sorted[0].location?.line).toBe(2);
    expect(sorted[0].code).toBe('AIR-E001');
    expect(sorted[1].location?.line).toBe(2);
    expect(sorted[1].code).toBe('AIR-E003');
    expect(sorted[2].location?.line).toBe(5);
  });

  it('running sortDiagnostics twice produces identical order', () => {
    const diags: Diagnostic[] = [
      createDiagnostic('AIR-L001', 'info', 'Info', 'style'),
      createDiagnostic('AIR-E001', 'error', 'Error', 'structural'),
      createDiagnostic('AIR-W001', 'warning', 'Warning', 'structural'),
    ];
    const sorted1 = sortDiagnostics(diags);
    const sorted2 = sortDiagnostics(diags);
    expect(JSON.stringify(sorted1)).toBe(JSON.stringify(sorted2));
  });
});

// ---- Parse Error Wrapping ----

describe('parse error wrapping', () => {
  it('wraps AirParseError with AIR-P* code and location', () => {
    const err = new AirParseError('Unexpected token', { line: 3, col: 5, token: '{' });
    const diag = wrapParseError(err);
    expect(diag.code).toMatch(/^AIR-P/);
    expect(diag.severity).toBe('error');
    expect(diag.category).toBe('syntax');
    expect(diag.location?.line).toBe(3);
    expect(diag.location?.col).toBe(5);
    expect(diag.fix).toBeDefined();
  });

  it('wraps AirLexError with AIR-P002 for unterminated strings', () => {
    const err = new AirLexError('Unterminated string literal', 1, 10);
    const diag = wrapParseError(err);
    expect(diag.code).toBe('AIR-P002');
    expect(diag.severity).toBe('error');
    expect(diag.location?.line).toBe(1);
    expect(diag.location?.col).toBe(10);
  });

  it('wraps Expected errors as AIR-P003', () => {
    const err = new AirParseError("Expected open_brace '{', got open_paren '('", { line: 4, col: 4 });
    const diag = wrapParseError(err);
    expect(diag.code).toBe('AIR-P003');
  });

  it('wraps Unknown block type as AIR-P004', () => {
    const err = new AirParseError("Unknown block type '@foo'", { line: 2, col: 1 });
    const diag = wrapParseError(err);
    expect(diag.code).toBe('AIR-P004');
  });

  it('wraps Invalid type as AIR-P005', () => {
    const err = new AirParseError("Invalid type 'object'", { line: 3, col: 8 });
    const diag = wrapParseError(err);
    expect(diag.code).toBe('AIR-P005');
  });
});

// ---- Legacy Format Backward Compatibility ----

describe('legacy format compatibility', () => {
  it('validate() returns old shape (valid, errors[], warnings[])', () => {
    const ast = parse('@app:test\n@state{x:int}\n@ui(h1>"hi")');
    const result = validate(ast);
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('validate() missing @ui produces E002 error', () => {
    const ast = parse('@app:test\n@state{x:int}');
    const result = validate(ast);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'E002')).toBe(true);
  });

  it('validate() missing @state produces W001 warning', () => {
    const ast = parse('@app:test\n@ui(h1>"hi")');
    const result = validate(ast);
    expect(result.warnings.some(w => w.code === 'W001')).toBe(true);
  });

  it('toLegacyFormat converts DiagnosticResult to old shape', () => {
    const diagnostics: Diagnostic[] = [
      createDiagnostic('AIR-E001', 'error', 'No name', 'structural'),
      createDiagnostic('AIR-W001', 'warning', 'No state', 'structural', { fix: { description: 'Add @state' } }),
    ];
    const result = buildResult(diagnostics, 'abc');
    const legacy = toLegacyFormat(result);
    expect(legacy.valid).toBe(false);
    expect(legacy.errors).toHaveLength(1);
    expect(legacy.errors[0].code).toBe('E001');
    expect(legacy.warnings).toHaveLength(1);
    expect(legacy.warnings[0].code).toBe('W001');
    expect(legacy.warnings[0].suggestion).toBe('Add @state');
  });
});

// ---- Migrated Rule Verification ----

describe('migrated rule codes', () => {
  it('E001: missing @app:name', () => {
    // Construct a minimal AST with empty name (parser normally prevents this)
    const ast = { app: { name: '', blocks: [{ kind: 'ui' as const, children: [] }] } };
    const diags = diagnose(ast as any);
    expect(diags.some(d => d.code === 'AIR-E001')).toBe(true);
  });

  it('E002: missing @ui block', () => {
    const ast = parse('@app:test\n@state{x:int}');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E002')).toBe(true);
  });

  it('W001: missing @state block', () => {
    const ast = parse('@app:test\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W001')).toBe(true);
  });

  it('W002: @db without @api', () => {
    const ast = parse('@app:test\n@state{x:int}\n@db{Item{id:int:primary:auto,name:str}}\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W002')).toBe(true);
  });

  it('W004: unused state field', () => {
    const ast = parse('@app:test\n@state{x:int,unusedVar:str}\n@ui(h1>#x)');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W004' && d.message.includes('unusedVar'))).toBe(true);
  });

  it('L001: no @persist on frontend-only app', () => {
    const ast = parse('@app:test\n@state{items:[{id:int,name:str}]}\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-L001')).toBe(true);
  });

  it('E003: unknown model reference in @api', () => {
    const ast = parse('@app:test\n@state{x:int}\n@db{Item{id:int:primary:auto,name:str}}\n@api(GET:/tasks>~db.Task.findMany)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E003' && d.message.includes('Task'))).toBe(true);
  });
});

// ---- A1-Rules: Expanded Validator Rules ----

describe('A1-Rules: expanded validator rules', () => {
  it('E004: duplicate @page name', () => {
    const ast = parse('@app:test\n@state{x:int}\n@ui(@page:home(h1>"a")+@page:home(h1>"b"))');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E004' && d.message.includes('home'))).toBe(true);
  });

  it('E005: @nav references undefined page', () => {
    // nav(/>?user>page:nonexistent) → target=page, fallback=nonexistent
    const ast = parse('@app:test\n@state{x:int}\n@nav(/>?user>page:nonexistent)\n@ui(@page:home(h1>"hi"))');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E005' && d.message.includes('nonexistent'))).toBe(true);
  });

  it('E005: @nav valid reference does NOT produce error', () => {
    const ast = parse('@app:test\n@state{x:int}\n@nav(/>?user>page:login)\n@ui(@page:login(h1>"hi"))');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E005')).toBe(false);
  });

  it('E007: CRUD handler refs missing model', () => {
    const ast = parse('@app:test\n@state{x:int}\n@db{Item{id:int:primary:auto,name:str}}\n@api(CRUD:/tasks>~db.Task)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E007' && d.message.includes('Task'))).toBe(true);
  });

  it('E007: valid CRUD handler does NOT produce error', () => {
    const ast = parse('@app:test\n@state{x:int}\n@db{Item{id:int:primary:auto,name:str}}\n@api(CRUD:/items>~db.Item)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E007')).toBe(false);
  });

  it('W008: @auth(required) without login route produces warning', () => {
    const ast = parse('@app:test\n@state{x:int}\n@api(GET:/items>test)\n@auth(required)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W008')).toBe(true);
    expect(diags.find(d => d.code === 'AIR-W008')!.severity).toBe('warning');
  });

  it('W008: @auth(required) WITH login route does NOT produce warning', () => {
    const ast = parse('@app:test\n@state{x:int}\n@api(POST:/auth/login(email:str,password:str)>auth.login)\n@auth(required)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W008')).toBe(false);
  });

  it('W005: auth routes without @auth block', () => {
    const ast = parse('@app:test\n@state{x:int}\n@api(POST:/auth/login(email:str,password:str)>auth.login)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W005')).toBe(true);
  });

  it('W007: @db model no PK', () => {
    const ast = parse('@app:test\n@state{x:int}\n@db{Item{name:str,email:str}}\n@api(GET:/items>test)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W007' && d.message.includes('Item'))).toBe(true);
  });

  it('W007: model WITH PK does NOT produce warning', () => {
    const ast = parse('@app:test\n@state{x:int}\n@db{Item{id:int:primary:auto,name:str}}\n@api(GET:/items>test)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W007')).toBe(false);
  });

  it('L002: @style not specified', () => {
    const ast = parse('@app:test\n@state{x:int}\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-L002')).toBe(true);
  });

  it('L002: @style present does NOT produce info', () => {
    const ast = parse('@app:test\n@state{x:int}\n@style(theme:dark,accent:#6366f1)\n@ui(h1>"hi")');
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-L002')).toBe(false);
  });

  it('all A1-Rules diagnostics have fix hints', () => {
    const ast = parse('@app:test\n@state{x:int}\n@db{Item{name:str}}\n@api(CRUD:/tasks>~db.Task)\n@auth(required)\n@ui(@page:home(h1>"a")+@page:home(h1>"b"))');
    const diags = diagnose(ast);
    const ruleCodes = ['AIR-E004', 'AIR-E007', 'AIR-W008', 'AIR-W007'];
    for (const code of ruleCodes) {
      const d = diags.find(d => d.code === code);
      if (d) {
        expect(d.fix, `${code} should have fix hint`).toBeDefined();
        expect(d.fix!.description, `${code} fix should have description`).toBeTruthy();
      }
    }
  });
});

// ---- CLI Formatter ----

describe('CLI formatter', () => {
  it('formats error with location', () => {
    const diag = createDiagnostic('AIR-P001', 'error', 'Unexpected token', 'syntax', {
      location: { line: 3, col: 5, sourceLine: '@db(foo)' },
      fix: { description: 'Fix the syntax' },
    });
    const output = formatDiagnosticCLI(diag);
    expect(output).toContain('error[AIR-P001]');
    expect(output).toContain('line 3:5');
    expect(output).toContain('@db(foo)');
    expect(output).toContain('= fix: Fix the syntax');
  });

  it('formats warning without location', () => {
    const diag = createDiagnostic('AIR-W001', 'warning', 'No state block', 'structural');
    const output = formatDiagnosticCLI(diag);
    expect(output).toContain('warning[AIR-W001]');
    expect(output).not.toContain('-->');
  });

  it('formats info with block path', () => {
    const diag = createDiagnostic('AIR-L001', 'info', 'Missing persist', 'style', {
      block: '@state',
      path: 'items',
    });
    const output = formatDiagnosticCLI(diag);
    expect(output).toContain('info[AIR-L001]');
    expect(output).toContain('@state.items');
  });
});

// ---- OV-1.2: Deterministic Serialization ----

describe('deterministic serialization', () => {
  it('JSON.stringify of same DiagnosticResult is byte-for-byte identical', () => {
    const source = '@app:test\n@state{x:int}\n@ui(h1>"hi")';
    const ast = parse(source);
    const diags1 = diagnose(ast);
    const diags2 = diagnose(ast);
    const result1 = buildResult(diags1, hashSource(source));
    const result2 = buildResult(diags2, hashSource(source));
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('serialization is stable across 10 runs', () => {
    const source = '@app:test\n@state{x:int}\n@db{Item{name:str,email:str}}\n@api(GET:/items>test)\n@ui(h1>"hi")';
    const ast = parse(source);
    const serializations = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const diags = diagnose(ast);
      const result = buildResult(diags, hashSource(source));
      serializations.add(JSON.stringify(result));
    }
    expect(serializations.size).toBe(1);
  });

  it('source_hash is deterministic for same input', () => {
    const source = '@app:test\n@ui(h1>"hi")';
    expect(hashSource(source)).toBe(hashSource(source));
    expect(hashSource(source)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('different source produces different hash', () => {
    expect(hashSource('@app:a\n@ui(h1>"a")')).not.toBe(hashSource('@app:b\n@ui(h1>"b")'));
  });
});

// ---- OV-1.3: Fixture Corpus ----

describe('fixture corpus', () => {
  const readFixture = (name: string): string => {
    const { readFileSync } = require('fs');
    return readFileSync(`tests/fixtures/${name}`, 'utf-8');
  };

  it('parse-error-missing-brace.air produces AIR-P* diagnostic', () => {
    const source = readFixture('parse-error-missing-brace.air');
    try {
      parse(source);
      expect.unreachable('should throw parse error');
    } catch (err: any) {
      const diag = wrapParseError(err);
      expect(diag.code).toMatch(/^AIR-P/);
      expect(diag.severity).toBe('error');
      expect(diag.category).toBe('syntax');
      expect(diag.location).toBeDefined();
    }
  });

  it('parse-error-unknown-block.air produces AIR-P004', () => {
    const source = readFixture('parse-error-unknown-block.air');
    try {
      parse(source);
      expect.unreachable('should throw parse error');
    } catch (err: any) {
      const diag = wrapParseError(err);
      expect(diag.code).toBe('AIR-P004');
      expect(diag.message).toContain('Unknown block');
    }
  });

  it('parse-error-unterminated-string.air produces AIR-P002', () => {
    const source = readFixture('parse-error-unterminated-string.air');
    try {
      parse(source);
      expect.unreachable('should throw lex error');
    } catch (err: any) {
      const diag = wrapParseError(err);
      expect(diag.code).toBe('AIR-P002');
    }
  });

  it('validation-error-no-ui.air produces AIR-E002', () => {
    const source = readFixture('validation-error-no-ui.air');
    const ast = parse(source);
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E002')).toBe(true);
    const result = buildResult(diags, hashSource(source));
    expect(result.valid).toBe(false);
  });

  it('validation-error-unknown-model.air produces AIR-E003', () => {
    const source = readFixture('validation-error-unknown-model.air');
    const ast = parse(source);
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-E003')).toBe(true);
  });

  it('lint-warning-no-persist.air produces AIR-L001', () => {
    const source = readFixture('lint-warning-no-persist.air');
    const ast = parse(source);
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-L001')).toBe(true);
    const result = buildResult(diags, hashSource(source));
    expect(result.valid).toBe(true); // lint info doesn't make it invalid
  });

  it('lint-warning-db-no-api.air produces AIR-W002', () => {
    const source = readFixture('lint-warning-db-no-api.air');
    const ast = parse(source);
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W002')).toBe(true);
  });

  it('lint-warning-no-pk.air produces AIR-W007', () => {
    const source = readFixture('lint-warning-no-pk.air');
    const ast = parse(source);
    const diags = diagnose(ast);
    expect(diags.some(d => d.code === 'AIR-W007')).toBe(true);
  });

  it('valid-minimal.air produces no errors', () => {
    const source = readFixture('valid-minimal.air');
    const ast = parse(source);
    const diags = diagnose(ast);
    const result = buildResult(diags, hashSource(source));
    expect(result.valid).toBe(true);
    expect(result.summary.errors).toBe(0);
  });

  it('all fixtures produce valid DiagnosticResult shape', () => {
    const { readdirSync } = require('fs');
    const fixtures = readdirSync('tests/fixtures/').filter((f: string) => f.endsWith('.air'));
    expect(fixtures.length).toBeGreaterThanOrEqual(9);

    for (const fixture of fixtures) {
      const source = readFixture(fixture);
      let result: any;
      try {
        const ast = parse(source);
        const diags = diagnose(ast);
        result = buildResult(diags, hashSource(source));
      } catch (err: any) {
        const diag = wrapParseError(err);
        result = buildResult([diag], hashSource(source));
      }
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('diagnostics');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('source_hash');
      expect(result).toHaveProperty('schema_version', '1.0');
    }
  });
});

// ---- createDiagnostic factory ----

describe('createDiagnostic factory', () => {
  it('creates diagnostic with minimal fields', () => {
    const d = createDiagnostic('AIR-E001', 'error', 'test', 'structural');
    expect(d.code).toBe('AIR-E001');
    expect(d.severity).toBe('error');
    expect(d.message).toBe('test');
    expect(d.category).toBe('structural');
    expect(d.location).toBeUndefined();
    expect(d.block).toBeUndefined();
    expect(d.fix).toBeUndefined();
  });

  it('creates diagnostic with all optional fields', () => {
    const d = createDiagnostic('AIR-W001', 'warning', 'warn', 'semantic', {
      location: { line: 1, col: 1 },
      block: '@state',
      path: 'x',
      fix: { description: 'fix it', suggestion: '@state{x:int}' },
    });
    expect(d.location?.line).toBe(1);
    expect(d.block).toBe('@state');
    expect(d.path).toBe('x');
    expect(d.fix?.description).toBe('fix it');
    expect(d.fix?.suggestion).toBe('@state{x:int}');
  });
});

// ---- Summary Counting ----

describe('summary counting', () => {
  it('counts errors, warnings, and info correctly', () => {
    const diags: Diagnostic[] = [
      createDiagnostic('AIR-E001', 'error', 'err1', 'structural'),
      createDiagnostic('AIR-E002', 'error', 'err2', 'structural'),
      createDiagnostic('AIR-W001', 'warning', 'warn', 'structural'),
      createDiagnostic('AIR-L001', 'info', 'info', 'style'),
      createDiagnostic('AIR-L002', 'info', 'info2', 'style'),
    ];
    const result = buildResult(diags, 'hash');
    expect(result.summary.errors).toBe(2);
    expect(result.summary.warnings).toBe(1);
    expect(result.summary.info).toBe(2);
    expect(result.valid).toBe(false);
  });

  it('valid is true when no errors', () => {
    const diags: Diagnostic[] = [
      createDiagnostic('AIR-W001', 'warning', 'warn', 'structural'),
      createDiagnostic('AIR-L001', 'info', 'info', 'style'),
    ];
    const result = buildResult(diags, 'hash');
    expect(result.valid).toBe(true);
    expect(result.summary.errors).toBe(0);
  });
});
