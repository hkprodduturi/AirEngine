/**
 * Helpdesk Golden Run Tests (C5)
 *
 * Included in default CI (`npx vitest run`). Fast — helpdesk transpiles in <200ms.
 * Validates CAPABILITY_CHECKS structure and runHelpdeskGolden() outcome.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { CAPABILITY_CHECKS, runHelpdeskGolden } from '../scripts/helpdesk-golden-run.js';
import type { HelpdeskGoldenResult } from '../scripts/helpdesk-golden-run.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Structural Tests ----

describe('helpdesk golden: CAPABILITY_CHECKS structure', () => {
  const expectedGroups = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G12'];

  it('covers groups G1-G9 + G12', () => {
    const groups = CAPABILITY_CHECKS.map(g => g.group);
    for (const expected of expectedGroups) {
      expect(groups).toContain(expected);
    }
  });

  it('has 32 total checks', () => {
    const total = CAPABILITY_CHECKS.reduce((sum, g) => sum + g.checks.length, 0);
    expect(total).toBe(32);
  });

  it('each check has verify function and description', () => {
    for (const group of CAPABILITY_CHECKS) {
      expect(group.group).toBeTruthy();
      expect(group.name).toBeTruthy();
      for (const check of group.checks) {
        expect(typeof check.description).toBe('string');
        expect(check.description.length).toBeGreaterThan(0);
        expect(typeof check.verify).toBe('function');
      }
    }
  });

  it('group check counts match expected', () => {
    const countMap: Record<string, number> = {};
    for (const g of CAPABILITY_CHECKS) countMap[g.group] = g.checks.length;

    expect(countMap['G1']).toBe(4);
    expect(countMap['G2']).toBe(2);
    expect(countMap['G3']).toBe(5);
    expect(countMap['G4']).toBe(4);
    expect(countMap['G5']).toBe(3);
    expect(countMap['G6']).toBe(2);
    expect(countMap['G7']).toBe(2);
    expect(countMap['G8']).toBe(3);
    expect(countMap['G9']).toBe(4);
    expect(countMap['G12']).toBe(3);
  });
});

// ---- Integration Test ----

describe('helpdesk golden: runHelpdeskGolden()', () => {
  it('returns verdict=pass with 32/32 capabilities', async () => {
    const result = await runHelpdeskGolden();

    expect(result.verdict).toBe('pass');
    expect(result.capabilities.total_checks).toBe(32);
    expect(result.capabilities.passed_checks).toBe(32);
    expect(result.capabilities.all_passed).toBe(true);
    expect(result.pipeline.all_passed).toBe(true);
    expect(result.pipeline.file_count).toBeGreaterThan(0);
    expect(result.pipeline.deterministic).toBe(true);
  });

  it('conforms to helpdesk-golden-result schema', async () => {
    const result = await runHelpdeskGolden();
    const schema = JSON.parse(readFileSync('docs/helpdesk-golden-result.schema.json', 'utf-8'));
    const errors = validateJsonSchema(result, schema, schema);
    expect(errors).toEqual([]);
  });
});
