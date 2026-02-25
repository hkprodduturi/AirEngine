/**
 * Complex App Baseline Tests (C0)
 *
 * Sanity checks for helpdesk.air generation — included in default CI.
 * Verifies the baseline holds: parse + transpile succeeds, output is sane.
 *
 * Gap-specific acceptance tests live in complex-app-gaps.test.ts
 * and are excluded from default CI (run via: npm run test:complex-gaps).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';

// ---- Helpers ----

function transpileFile(name: string) {
  const source = readFileSync(`examples/${name}.air`, 'utf-8');
  const ast = parse(source);
  return transpile(ast, { sourceLines: source.split('\n').length });
}

// ---- Helpdesk Baseline ----

describe('Helpdesk baseline (C0)', () => {
  it('generates expected file count for complex app', () => {
    const result = transpileFile('helpdesk');
    // Baseline: 34 files. After C1-C4 should be 35+ (detail page, etc.)
    expect(result.files.length).toBeGreaterThanOrEqual(34);
  });

  it('all stages produce valid output', () => {
    const result = transpileFile('helpdesk');
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.stats.outputLines).toBeGreaterThan(1000);
  });

  it('no broken imports in generated client files', () => {
    const result = transpileFile('helpdesk');
    const clientFiles = result.files.filter(f =>
      f.path.startsWith('client/') && f.path.endsWith('.jsx')
    );

    for (const f of clientFiles) {
      const imports = f.content.match(/from\s+['"]([^'"]+)['"]/g) || [];
      for (const imp of imports) {
        const path = imp.match(/['"]([^'"]+)['"]/)?.[1];
        if (!path || path.startsWith('react') || path.startsWith('@')) continue;
        expect(path).not.toContain('undefined');
      }
    }
  });
});
