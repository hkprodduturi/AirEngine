/**
 * Performance Regression Benchmarks (6D)
 *
 * Measures parse + transpile time for each example and enforces
 * a ceiling (200ms per example) so regressions are caught early.
 *
 * Run:  npx vitest run tests/bench.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from '../src/parser/index.js';
import { transpile } from '../src/transpiler/index.js';

const EXAMPLES = ['todo', 'expense-tracker', 'auth', 'dashboard', 'landing', 'fullstack-todo', 'projectflow'];
const MAX_MS = 200; // ceiling per example — currently ~50ms

describe('Performance regression', () => {
  for (const name of EXAMPLES) {
    it(`${name}.air parse+transpile under ${MAX_MS}ms`, () => {
      const source = readFileSync(`examples/${name}.air`, 'utf-8');

      // Warm-up run (JIT, module loading)
      const warmAst = parse(source);
      transpile(warmAst);

      // Timed run
      const start = performance.now();
      const ast = parse(source);
      const result = transpile(ast);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(MAX_MS);
      expect(result.files.length).toBeGreaterThan(0);
    });
  }

  it('projectflow (largest) output is stable size', () => {
    const source = readFileSync('examples/projectflow.air', 'utf-8');
    const ast = parse(source);
    const result = transpile(ast);

    // projectflow generates ~47 files and ~2000+ lines
    expect(result.files.length).toBeGreaterThan(30);
    expect(result.stats.outputLines).toBeGreaterThan(1500);
  });

  it('cumulative parse+transpile for all examples under 500ms', () => {
    const start = performance.now();
    for (const name of EXAMPLES) {
      const source = readFileSync(`examples/${name}.air`, 'utf-8');
      const ast = parse(source);
      transpile(ast);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
