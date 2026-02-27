/**
 * Parser Trace Tests (H11 Gap Closure — B1)
 *
 * Tests for parser root-cause trace registry, detection, and fix application.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

import {
  PARSER_TRACE_REGISTRY,
  getParserTraceById,
  traceToParser,
  runAllParserTraces,
  parserTraceAsCodegenTrace,
} from '../src/self-heal/parser-trace.js';

import { isAllowedSelfHealPatchTarget } from '../src/self-heal/transpiler-patch.js';

// ---- Registry Tests ----

describe('Parser Trace Registry', () => {
  it('has at least 2 rules with required fields', () => {
    expect(PARSER_TRACE_REGISTRY.length).toBeGreaterThanOrEqual(2);
    for (const entry of PARSER_TRACE_REGISTRY) {
      expect(entry.id).toMatch(/^PSH-\d{3}$/);
      expect(entry.name).toBeTruthy();
      expect(entry.classification_ids.length).toBeGreaterThan(0);
      expect(entry.parser_file).toBeTruthy();
      expect(entry.parser_function).toBeTruthy();
      expect(entry.fix).toBeDefined();
      expect(entry.fix.target_file).toBeTruthy();
      expect(entry.fix.target_function).toBeTruthy();
      expect(typeof entry.fix.apply).toBe('function');
      expect(typeof entry.detect).toBe('function');
    }
  });

  it('getParserTraceById returns correct entry', () => {
    const psh001 = getParserTraceById('PSH-001');
    expect(psh001).toBeDefined();
    expect(psh001!.id).toBe('PSH-001');
    expect(psh001!.name).toContain('onDelete');
  });

  it('getParserTraceById returns undefined for unknown', () => {
    expect(getParserTraceById('PSH-999')).toBeUndefined();
    expect(getParserTraceById('SH9-001')).toBeUndefined();
  });

  it('all parser trace target files pass isAllowedSelfHealPatchTarget', () => {
    for (const entry of PARSER_TRACE_REGISTRY) {
      expect(isAllowedSelfHealPatchTarget(entry.fix.target_file)).toBe(true);
    }
  });
});

// ---- PSH-001: Relation onDelete Dropped ----

describe('PSH-001: Relation onDelete Dropped', () => {
  const psh001 = getParserTraceById('PSH-001')!;

  it('not detected when no @relation or no explicit cascade', () => {
    const source = `@app:mystore
@db{
  Product{name:string, price:number}
}
@ui{
  heading "Products"
}`;
    const ast = {
      blocks: [
        { kind: 'db', models: [{ name: 'Product', fields: [] }], relations: [], indexes: [] },
        { kind: 'ui', nodes: [] },
      ],
    };
    const result = psh001.detect(source, ast);
    expect(result.detected).toBe(false);
  });

  it('detected when source has :cascade but AST has no onDelete', () => {
    const source = `@app:mystore
@db{
  Order{total:number}
  Product{name:string}
  @relation(Order.product<>Product.orders:cascade)
}`;
    const ast = {
      blocks: [
        {
          kind: 'db',
          models: [
            { name: 'Order', fields: [] },
            { name: 'Product', fields: [] },
          ],
          relations: [
            { from: 'Order.product', to: 'Product.orders' /* no onDelete */ },
          ],
          indexes: [],
        },
      ],
    };
    const result = psh001.detect(source, ast);
    expect(result.detected).toBe(true);
    expect(result.affected_lines.length).toBeGreaterThan(0);
  });

  it('not detected when AST has matching onDelete', () => {
    const source = `@app:mystore
@db{
  Order{total:number}
  Product{name:string}
  @relation(Order.product<>Product.orders:cascade)
}`;
    const ast = {
      blocks: [
        {
          kind: 'db',
          models: [
            { name: 'Order', fields: [] },
            { name: 'Product', fields: [] },
          ],
          relations: [
            { from: 'Order.product', to: 'Product.orders', onDelete: 'cascade' },
          ],
          indexes: [],
        },
      ],
    };
    const result = psh001.detect(source, ast);
    expect(result.detected).toBe(false);
  });

  it('fix.apply produces non-identity output with behavioral change', () => {
    // Read the actual parser source file
    const parserSource = readFileSync('src/parser/parsers.ts', 'utf-8');
    const patched = psh001.fix.apply(parserSource);
    // PSH-001 fix should produce real behavioral change — non-identity
    expect(patched).not.toBe(parserSource);
    // The fix adds an `else if (s.is('identifier'))` branch that consumes
    // unknown referential action identifiers instead of restoring
    expect(patched).toContain('PSH-001: consume unknown referential action identifier');
    expect(patched).toContain("} else if (s.is('identifier'))");
    // The original `s.restore(save)` path is still present as final fallback
    expect(patched).toContain('s.restore(save)');
  });
});

// ---- PSH-002: UI Scope Name Lost ----

describe('PSH-002: UI Scope Name Lost', () => {
  const psh002 = getParserTraceById('PSH-002')!;

  it('not detected when no @page/@section or all names preserved', () => {
    const source = `@app:myapp
@ui{
  heading "Hello"
  button "Click"
}`;
    const ast = {
      blocks: [
        { kind: 'ui', nodes: [{ kind: 'element', tag: 'heading' }] },
      ],
    };
    const result = psh002.detect(source, ast);
    expect(result.detected).toBe(false);
  });

  it('not detected when AST has matching scope names', () => {
    const source = `@app:myapp
@ui{
  @page:Dashboard
    heading "Dashboard"
  @page:Settings
    heading "Settings"
}`;
    const ast = {
      blocks: [
        {
          kind: 'ui',
          nodes: [
            { kind: 'scoped', name: 'Dashboard', children: [] },
            { kind: 'scoped', name: 'Settings', children: [] },
          ],
        },
      ],
    };
    const result = psh002.detect(source, ast);
    expect(result.detected).toBe(false);
  });

  it('detected when source has @page:Name but AST is missing it', () => {
    const source = `@app:myapp
@ui{
  @page:Dashboard
    heading "Dashboard"
  @page:Settings
    heading "Settings"
}`;
    const ast = {
      blocks: [
        {
          kind: 'ui',
          nodes: [
            { kind: 'scoped', name: 'Dashboard', children: [] },
            // Settings missing from AST
          ],
        },
      ],
    };
    const result = psh002.detect(source, ast);
    expect(result.detected).toBe(true);
    expect(result.affected_lines.length).toBe(1);
  });

  it('fix.apply is identity (scaffolding)', () => {
    const source = 'function parseUIBlock() { /* ... */ }';
    const patched = psh002.fix.apply(source);
    expect(patched).toBe(source);
  });
});

// ---- Trace Lookup ----

describe('Parser Trace Lookup', () => {
  it('traceToParser returns null for unmatched classification', () => {
    const result = traceToParser('nonexistent-classification', '', {});
    expect(result).toBeNull();
  });

  it('traceToParser returns null when classification matches but not detected', () => {
    const source = '@app:test\n@ui{ heading "Hi" }';
    const ast = { blocks: [{ kind: 'ui', nodes: [] }] };
    const result = traceToParser('cascade-missing', source, ast);
    expect(result).toBeNull();
  });

  it('runAllParserTraces returns empty for clean source', () => {
    const source = '@app:test\n@ui{ heading "Hello" }';
    const ast = {
      blocks: [
        { kind: 'ui', nodes: [{ kind: 'element', tag: 'heading' }] },
      ],
    };
    const results = runAllParserTraces(source, ast);
    expect(results).toEqual([]);
  });
});

// ---- Adapter ----

describe('parserTraceAsCodegenTrace adapter', () => {
  it('produces valid CodegenTraceEntry shape', () => {
    const psh001 = getParserTraceById('PSH-001')!;
    const parserResult = {
      detected: true,
      severity: 'p1' as const,
      details: 'test',
      affected_lines: [{ line: 5, snippet: '@relation(A.b<>B.a:cascade)' }],
    };

    const { trace, result } = parserTraceAsCodegenTrace(psh001, parserResult);

    expect(trace.id).toBe('PSH-001');
    expect(trace.transpiler_file).toBe(psh001.parser_file);
    expect(trace.transpiler_function).toBe(psh001.parser_function);
    expect(typeof trace.fix.apply).toBe('function');
    expect(result.detected).toBe(true);
    expect(result.affected_files).toContain(psh001.parser_file);
  });
});
