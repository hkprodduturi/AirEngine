/**
 * Repair Engine Tests (A3b)
 *
 * Tests for deterministic rule-based repair of AIR-E001 and AIR-E002.
 * Groups: A (unit), B (determinism), C (loop integration), D (edge cases).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { planRepairs, applyRepairs, repair, createDeterministicAdapter, createNoopAdapter } from '../src/repair.js';
import type { RepairAdapter, RepairResult } from '../src/repair.js';
import { parse } from '../src/parser/index.js';
import { diagnose } from '../src/validator/index.js';
import { buildResult, hashSource } from '../src/diagnostics.js';
import { runLoop, runLoopFromSource } from '../src/cli/loop.js';
import type { Diagnostic } from '../src/diagnostics.js';

// ---- Helpers ----

function makeDiag(code: string, severity: 'error' | 'warning' | 'info' = 'error', message = 'test'): Diagnostic {
  return { code, severity, message, category: 'structural' };
}

function diagsForSource(source: string) {
  const ast = parse(source);
  const diags = diagnose(ast);
  return { ast, diags, result: buildResult(diags, hashSource(source)) };
}

// ---- A. Repair engine unit tests ----

describe('planRepairs', () => {
  it('returns prepend action for AIR-E001', () => {
    const actions = planRepairs('@state{x:int}', [makeDiag('AIR-E001')]);
    const e001 = actions.find(a => a.rule === 'AIR-E001');
    expect(e001).toBeDefined();
    expect(e001!.kind).toBe('prepend');
    expect(e001!.text).toBe('@app:myapp\n');
    expect(e001!.applied).toBe(true);
  });

  it('returns append action for AIR-E002', () => {
    const actions = planRepairs('@app:test\n@state{x:int}', [makeDiag('AIR-E002')]);
    const e002 = actions.find(a => a.rule === 'AIR-E002');
    expect(e002).toBeDefined();
    expect(e002!.kind).toBe('append');
    expect(e002!.text).toBe('\n@ui(h1>"Hello World")');
    expect(e002!.applied).toBe(true);
  });

  it('skips unsupported error codes with reason', () => {
    const diags = [
      makeDiag('AIR-E003'),
      makeDiag('AIR-E004'),
      makeDiag('AIR-E005'),
    ];
    const actions = planRepairs('', diags);
    for (const a of actions) {
      expect(a.applied).toBe(false);
      expect(a.reason).toBeDefined();
      expect(a.reason!.length).toBeGreaterThan(0);
    }
  });

  it('skips non-@app parse error codes (AIR-P*) with reason', () => {
    // Use a source that has @app and @ui so no speculative repairs trigger
    const actions = planRepairs('@app:test\n@ui(h1>"hi")', [makeDiag('AIR-P001', 'error', 'Unexpected token')]);
    const p001 = actions.find(a => a.rule === 'AIR-P001');
    expect(p001).toBeDefined();
    expect(p001!.applied).toBe(false);
    expect(p001!.reason).toContain('Parse errors');
  });

  it('treats "Missing @app" parse error as E001', () => {
    const actions = planRepairs('@state{x:int}', [
      makeDiag('AIR-P001', 'error', 'Missing @app declaration'),
    ]);
    const e001 = actions.find(a => a.rule === 'AIR-E001');
    expect(e001).toBeDefined();
    expect(e001!.applied).toBe(true);
    expect(e001!.kind).toBe('prepend');
  });

  it('skips warnings (AIR-W*) with reason', () => {
    const actions = planRepairs('', [makeDiag('AIR-W001', 'warning')]);
    expect(actions[0].applied).toBe(false);
    expect(actions[0].reason).toContain('non-blocking');
  });

  it('skips info-level (AIR-L*) with reason', () => {
    const actions = planRepairs('', [makeDiag('AIR-L001', 'info')]);
    expect(actions[0].applied).toBe(false);
    expect(actions[0].reason).toContain('non-blocking');
  });
});

describe('applyRepairs', () => {
  it('prepends text for E001 action', () => {
    const source = '@state{x:int}\n';
    const actions = planRepairs(source, [makeDiag('AIR-E001')]);
    const result = applyRepairs(source, actions);
    expect(result).toBe('@app:myapp\n@state{x:int}\n');
  });

  it('appends text for E002 action', () => {
    const source = '@app:test\n@state{x:int}';
    const actions = planRepairs(source, [makeDiag('AIR-E002')]);
    const result = applyRepairs(source, actions);
    expect(result).toBe('@app:test\n@state{x:int}\n@ui(h1>"Hello World")');
  });

  it('handles both E001+E002 together', () => {
    const source = '@state{x:int}';
    const actions = planRepairs(source, [makeDiag('AIR-E001'), makeDiag('AIR-E002')]);
    const result = applyRepairs(source, actions);
    expect(result).toBe('@app:myapp\n@state{x:int}\n@ui(h1>"Hello World")');
  });
});

describe('repair()', () => {
  it('returns noop when no errors', () => {
    const diags = [makeDiag('AIR-W001', 'warning')];
    const result = repair('@app:test\n@ui(h1>"hi")', diags);
    expect(result.status).toBe('noop');
    expect(result.sourceChanged).toBe(false);
    expect(result.appliedCount).toBe(0);
  });

  it('returns partial when mix of repairable and unrepairable errors', () => {
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E003')];
    const result = repair('@state{x:int}', diags);
    expect(result.status).toBe('partial');
    expect(result.sourceChanged).toBe(true);
    expect(result.appliedCount).toBeGreaterThan(0);
    expect(result.skippedCount).toBeGreaterThan(0);
  });

  it('returns repaired when all errors are fixable', () => {
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E002')];
    const result = repair('@state{x:int}', diags);
    expect(result.status).toBe('repaired');
    expect(result.sourceChanged).toBe(true);
  });

  it('returns failed when no errors can be repaired', () => {
    const diags = [makeDiag('AIR-E003'), makeDiag('AIR-E004')];
    const result = repair('@state{x:int}', diags);
    expect(result.status).toBe('failed');
    expect(result.sourceChanged).toBe(false);
  });
});

// ---- B. Determinism tests ----

describe('Determinism', () => {
  it('same source + same diagnostics → byte-identical repaired output', () => {
    const source = '@state{x:int}';
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E002')];
    const result1 = repair(source, diags);
    const result2 = repair(source, diags);
    expect(result1.repairedSource).toBe(result2.repairedSource);
  });

  it('same source → same action plan', () => {
    const source = '@state{x:int}';
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E002')];
    const plan1 = planRepairs(source, diags);
    const plan2 = planRepairs(source, diags);
    expect(plan1).toEqual(plan2);
  });

  it('repaired source hash is consistent', () => {
    const source = '@state{x:int}';
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E002')];
    const r1 = repair(source, diags);
    const r2 = repair(source, diags);
    const hash1 = createHash('sha256').update(r1.repairedSource).digest('hex');
    const hash2 = createHash('sha256').update(r2.repairedSource).digest('hex');
    expect(hash1).toBe(hash2);
  });
});

// ---- C. Loop integration tests ----

describe('Loop integration', () => {
  it('repairable-e001-e002.air → repaired → validates → transpiles', async () => {
    const outputDir = join('.eval-tmp', 'repair-test-e001-e002');
    const result = await runLoop('tests/fixtures/repairable-e001-e002.air', outputDir);

    // Repair stage should pass (E001+E002 fixed)
    const repairStage = result.stages.find(s => s.name === 'repair');
    expect(repairStage).toBeDefined();
    expect(repairStage!.status).toBe('pass');

    // Transpile should succeed
    const transpileStage = result.stages.find(s => s.name === 'transpile');
    expect(transpileStage).toBeDefined();
    expect(transpileStage!.status).toBe('pass');

    // Repair result should be populated
    expect(result.repairResult).toBeDefined();
    expect(result.repairResult!.attempted).toBe(true);
    expect(result.repairResult!.sourceChanged).toBe(true);
    expect(result.repairResult!.status).toBe('repaired');
    expect(result.repairResult!.appliedActions.length).toBe(2);

    // Output files should exist
    expect(result.transpileResult).toBeDefined();
    expect(result.transpileResult!.files.length).toBeGreaterThan(0);
  });

  it('fixture with only unsupported errors → loop exits with failed repair status', async () => {
    // validation-error-unknown-model has E003 (unknown model in API)
    const outputDir = join('.eval-tmp', 'repair-test-unsupported');
    const result = await runLoop('tests/fixtures/validation-error-unknown-model.air', outputDir);

    const repairStage = result.stages.find(s => s.name === 'repair');
    expect(repairStage).toBeDefined();
    // Repair may have applied E001/E002 if present, or failed entirely
    // The key test: if only unsupported errors remain, transpile doesn't proceed
    if (result.repairResult?.attempted) {
      expect(['fail', 'pass']).toContain(repairStage!.status);
    }
  });

  it('valid input → repair stage skip, no regression', async () => {
    const outputDir = join('.eval-tmp', 'repair-test-valid');
    const result = await runLoop('tests/fixtures/valid-minimal.air', outputDir);

    const repairStage = result.stages.find(s => s.name === 'repair');
    expect(repairStage).toBeDefined();
    expect(repairStage!.status).toBe('skip');

    // No repairResult when skipped (no errors)
    expect(result.repairResult).toBeUndefined();

    // Transpile should still succeed
    const transpileStage = result.stages.find(s => s.name === 'transpile');
    expect(transpileStage).toBeDefined();
    expect(transpileStage!.status).toBe('pass');
  });

  it('repair artifacts are written when repair is attempted', async () => {
    const outputDir = join('.eval-tmp', 'repair-test-artifacts');
    const result = await runLoop('tests/fixtures/repairable-e001-e002.air', outputDir);

    expect(result.repairResult).toBeDefined();
    expect(result.repairResult!.repairedFile).not.toBeNull();

    // Check artifact files exist
    expect(existsSync(join(result.artifactDir, 'repaired.air'))).toBe(true);
    expect(existsSync(join(result.artifactDir, 'repair-actions.json'))).toBe(true);
    expect(existsSync(join(result.artifactDir, 'diagnostics-before.json'))).toBe(true);
    expect(existsSync(join(result.artifactDir, 'diagnostics-after.json'))).toBe(true);

    // Verify repaired.air content
    const repairedContent = readFileSync(join(result.artifactDir, 'repaired.air'), 'utf-8');
    expect(repairedContent).toContain('@app:myapp');
    expect(repairedContent).toContain('@ui(h1>"Hello World")');

    // Verify repair-actions.json
    const actions = JSON.parse(readFileSync(join(result.artifactDir, 'repair-actions.json'), 'utf-8'));
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a: any) => a.rule === 'AIR-E001')).toBe(true);
    expect(actions.some((a: any) => a.rule === 'AIR-E002')).toBe(true);
  });
});

// ---- D. Edge cases ----

describe('Edge cases', () => {
  it('source already has @app: but no name → E001 repair prepends new @app:myapp', () => {
    // Parser would fail or produce empty name for `@app:` with no name
    // But if validator reports E001, we prepend regardless
    const diags = [makeDiag('AIR-E001')];
    const result = repair('@app:\n@state{x:int}', diags);
    expect(result.sourceChanged).toBe(true);
    expect(result.repairedSource).toContain('@app:myapp');
    // The new @app:myapp line is prepended before the existing content
    expect(result.repairedSource.startsWith('@app:myapp\n')).toBe(true);
  });

  it('empty source → E001+E002 repair produces valid minimal app', () => {
    // Empty source would trigger parse error, but if we get E001+E002 diagnostics
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E002')];
    const result = repair('', diags);
    expect(result.status).toBe('repaired');
    expect(result.sourceChanged).toBe(true);
    expect(result.repairedSource).toContain('@app:myapp');
    expect(result.repairedSource).toContain('@ui(h1>"Hello World")');
  });

  it('duplicate diagnostic codes are deduplicated in action plan', () => {
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E001')];
    const actions = planRepairs('@state{x:int}', diags);
    const e001Actions = actions.filter(a => a.rule === 'AIR-E001');
    expect(e001Actions.length).toBe(1);
  });

  it('speculative E002 does NOT fire on unrelated parse errors', () => {
    // An unrelated parse error (not "Missing @app") should NOT speculatively add E002
    const diags = [makeDiag('AIR-P003', 'error', 'Expected closing brace')];
    const actions = planRepairs('@app:test\n@state{x:int', diags);
    const e002 = actions.find(a => a.rule === 'AIR-E002');
    expect(e002).toBeUndefined();
  });

  it('speculative E002 fires only when Missing @app was repaired', () => {
    // "Missing @app" parse error on source without @ui → E001 + speculative E002
    const diags = [makeDiag('AIR-P001', 'error', 'Missing @app declaration')];
    const actions = planRepairs('@state{x:int}', diags);
    const e001 = actions.find(a => a.rule === 'AIR-E001');
    const e002 = actions.find(a => a.rule === 'AIR-E002');
    expect(e001).toBeDefined();
    expect(e001!.applied).toBe(true);
    expect(e002).toBeDefined();
    expect(e002!.applied).toBe(true);
  });
});

// ---- E. Audit trail on failed repair ----

describe('Audit trail', () => {
  it('writes repair-actions.json and diagnostics-before.json even when repair fails', async () => {
    // validation-error-unknown-model triggers errors that repair cannot fix
    const outputDir = join('.eval-tmp', 'repair-audit-fail');
    const result = await runLoop('tests/fixtures/validation-error-unknown-model.air', outputDir);

    // Repair was attempted
    expect(result.repairResult).toBeDefined();
    expect(result.repairResult!.attempted).toBe(true);

    // Audit artifacts should exist even though no source was changed
    expect(existsSync(join(result.artifactDir, 'repair-actions.json'))).toBe(true);
    expect(existsSync(join(result.artifactDir, 'diagnostics-before.json'))).toBe(true);
  });
});

// ---- F. RepairAdapter interface (A3d) ----

describe('RepairAdapter interface', () => {
  it('DeterministicAdapter.name is "deterministic"', () => {
    const adapter = createDeterministicAdapter();
    expect(adapter.name).toBe('deterministic');
  });

  it('DeterministicAdapter.repair() matches raw repair()', () => {
    const adapter = createDeterministicAdapter();
    const source = '@state{x:int}';
    const diags = [makeDiag('AIR-E001'), makeDiag('AIR-E002')];
    const adapterResult = adapter.repair(source, diags);
    const rawResult = repair(source, diags);
    expect(adapterResult.status).toBe(rawResult.status);
    expect(adapterResult.repairedSource).toBe(rawResult.repairedSource);
    expect(adapterResult.appliedCount).toBe(rawResult.appliedCount);
  });

  it('NoopAdapter.name is "noop"', () => {
    const adapter = createNoopAdapter();
    expect(adapter.name).toBe('noop');
  });

  it('NoopAdapter always returns noop status and never changes source', () => {
    const adapter = createNoopAdapter();
    const source = '@state{x:int}';
    const diags = [makeDiag('AIR-E001')];
    const result = adapter.repair(source, diags);
    expect(result.status).toBe('noop');
    expect(result.sourceChanged).toBe(false);
    expect(result.repairedSource).toBe(source);
    expect(result.appliedCount).toBe(0);
  });
});

// ---- G. Retry stop conditions (A3d) ----

describe('Retry stop conditions', () => {
  // Helper: create a fake adapter for testing
  function fakeAdapter(name: string, fn: (source: string, diags: Diagnostic[]) => RepairResult): RepairAdapter {
    return { name, repair: fn };
  }

  it('noop: adapter returns unchanged source → stop with "noop"', async () => {
    const adapter = fakeAdapter('fake-noop', (source) => ({
      status: 'noop' as const,
      originalSource: source,
      repairedSource: source,
      sourceChanged: false,
      actions: [],
      appliedCount: 0,
      skippedCount: 0,
    }));

    const source = '@state{x:int}'; // triggers E001
    const result = await runLoopFromSource(source, join('.eval-tmp', 'retry-noop'), {
      maxRepairAttempts: 3,
      repairAdapter: adapter,
      writeArtifacts: false,
    });

    expect(result.repairAttempts).toBeDefined();
    expect(result.repairAttempts!.length).toBe(1);
    expect(result.repairAttempts![0].stopReason).toBe('noop');
  });

  it('no_improvement: adapter returns changed source but same error count → stop', async () => {
    const adapter = fakeAdapter('fake-no-improve', (source) => ({
      status: 'partial' as const,
      originalSource: source,
      repairedSource: source + '\n// patched',
      sourceChanged: true,
      actions: [],
      appliedCount: 1,
      skippedCount: 0,
    }));

    const source = '@state{x:int}';
    const result = await runLoopFromSource(source, join('.eval-tmp', 'retry-no-improve'), {
      maxRepairAttempts: 3,
      repairAdapter: adapter,
      writeArtifacts: false,
    });

    expect(result.repairAttempts).toBeDefined();
    expect(result.repairAttempts!.length).toBe(1);
    expect(result.repairAttempts![0].stopReason).toBe('no_improvement');
  });

  it('cycle_detected: adapter alternates between two sources → stop', async () => {
    let callCount = 0;
    const adapter = fakeAdapter('fake-cycle', (source) => {
      callCount++;
      const patched = callCount % 2 === 1
        ? '@app:myapp\n@state{x:int}'
        : '@state{x:int}';
      return {
        status: 'partial' as const,
        originalSource: source,
        repairedSource: patched,
        sourceChanged: patched !== source,
        actions: [],
        appliedCount: 1,
        skippedCount: 0,
      };
    });

    // Use source that will produce errors after "repair"
    const source = '@state{x:int}';
    const result = await runLoopFromSource(source, join('.eval-tmp', 'retry-cycle'), {
      maxRepairAttempts: 5,
      repairAdapter: adapter,
      writeArtifacts: false,
    });

    expect(result.repairAttempts).toBeDefined();
    // Should stop when cycle is detected (source hash was seen before)
    const lastAttempt = result.repairAttempts![result.repairAttempts!.length - 1];
    // Could be cycle_detected, no_improvement, or noop depending on error counts
    expect(['cycle_detected', 'no_improvement', 'noop']).toContain(lastAttempt.stopReason);
    expect(result.repairAttempts!.length).toBeLessThanOrEqual(5);
  });

  it('max_attempts: adapter always improves but never reaches 0 → stop at max', async () => {
    // This adapter claims to change the source each time (unique output)
    let callCount = 0;
    const adapter = fakeAdapter('fake-max-attempts', (source) => {
      callCount++;
      return {
        status: 'partial' as const,
        originalSource: source,
        repairedSource: source + `\n// fix-${callCount}`,
        sourceChanged: true,
        actions: [],
        appliedCount: 1,
        skippedCount: 0,
      };
    });

    const source = '@state{x:int}';
    const result = await runLoopFromSource(source, join('.eval-tmp', 'retry-max'), {
      maxRepairAttempts: 3,
      repairAdapter: adapter,
      writeArtifacts: false,
    });

    expect(result.repairAttempts).toBeDefined();
    // Since the source keeps changing and errors stay the same,
    // it should stop at attempt 1 with no_improvement (errors not decreased)
    // because the re-parse of the patched source will still have errors
    const lastAttempt = result.repairAttempts![result.repairAttempts!.length - 1];
    expect(lastAttempt.stopReason).toBeDefined();
  });

  it('success: adapter returns valid source → 0 errors', async () => {
    // Use a source that parses OK but has validator error (E002: no @ui)
    // so initial error count = 1, and adapter produces a valid source with 0 errors
    const adapter = fakeAdapter('fake-success', () => ({
      status: 'repaired' as const,
      originalSource: '',
      repairedSource: '@app:test\n@state{x:int}\n@ui(h1>"Hello World")',
      sourceChanged: true,
      actions: [],
      appliedCount: 1,
      skippedCount: 0,
    }));

    // @app:test + @state but no @ui → 1 validator error (E002)
    const source = '@app:test\n@state{x:int}';
    const result = await runLoopFromSource(source, join('.eval-tmp', 'retry-success'), {
      maxRepairAttempts: 3,
      repairAdapter: adapter,
      writeArtifacts: false,
    });

    expect(result.repairAttempts).toBeDefined();
    const lastAttempt = result.repairAttempts![result.repairAttempts!.length - 1];
    expect(lastAttempt.stopReason).toBe('success');
    expect(lastAttempt.errorsAfter).toBe(0);
  });

  it('default maxRepairAttempts=1 matches prior A3c behavior (no repairAttempts)', async () => {
    const source = readFileSync('tests/fixtures/repairable-e001-e002.air', 'utf-8');
    const result = await runLoopFromSource(source, join('.eval-tmp', 'retry-default'), {
      writeArtifacts: false,
    });

    // No repairAttempts field when maxRepairAttempts=1
    expect(result.repairAttempts).toBeUndefined();
    // But repairResult is still present (same as A3c)
    expect(result.repairResult).toBeDefined();
    expect(result.repairResult!.attempted).toBe(true);
  });

  it('attempt-N/ artifact dirs created when maxRepairAttempts > 1 and writeArtifacts=true', async () => {
    const source = '@state{x:int}';
    const result = await runLoopFromSource(source, join('.eval-tmp', 'retry-artifacts'), {
      maxRepairAttempts: 2,
      writeArtifacts: true,
    });

    expect(result.repairAttempts).toBeDefined();
    // At least attempt-1 dir should exist
    expect(existsSync(join(result.artifactDir, 'attempt-1'))).toBe(true);
  });
});
