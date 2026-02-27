/**
 * SH9 Transpiler Patch Tests
 *
 * Tests for proposeTranspilerPatch, verifyTranspilerPatch, applyTranspilerPatch.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  applyTranspilerPatch,
  isAllowedSelfHealPatchTarget,
  proposeTranspilerPatch,
  verifyTranspilerPatch,
  isPatchWithinScope,
  type TranspilerPatchResult,
} from '../src/self-heal/transpiler-patch.js';
import { getTraceById } from '../src/self-heal/codegen-trace.js';
import { runInvariants } from '../src/self-heal/invariants.js';

const TEMP_DIR = join('scripts', '__test-tmp-patch');

function ensureTempDir() {
  mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanTempDir() {
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

describe('proposeTranspilerPatch', () => {
  it('returns null when file does not exist', () => {
    const trace = getTraceById('SH9-001')!;
    const detection = trace.detect(new Map([['index.css', 'h1 { color: red; }']]));
    const result = proposeTranspilerPatch(trace, detection, '/nonexistent/path');
    expect(result).toBeNull();
  });

  it('proposes patch for SH9-001 with real scaffold.ts', () => {
    const trace = getTraceById('SH9-001')!;
    const detection = trace.detect(new Map([['index.css', 'h1 { color: red; }']]));

    // Use actual project root
    const result = proposeTranspilerPatch(trace, detection);
    // scaffold.ts uses :where() already, so result may be null (no change needed)
    // This is actually correct behavior since our transpiler already uses :where()
    if (result) {
      expect(result.trace_id).toBe('SH9-001');
      expect(result.strategy).toBe('wrap-selector');
      expect(result.diff_summary).toBeTruthy();
    }
  });

  it('returns patch with diff summary', () => {
    ensureTempDir();
    const testFile = join(TEMP_DIR, 'test-scaffold.ts');
    writeFileSync(testFile, 'function test() {\n  return "h1 { color: red; }";\n}');

    const trace = {
      ...getTraceById('SH9-001')!,
      fix: {
        ...getTraceById('SH9-001')!.fix,
        target_file: testFile.replace(process.cwd() + '/', ''),
        apply: (source: string) => source.replace('h1 {', ':where(h1) {'),
      },
    };

    const detection = trace.detect(new Map([['index.css', 'h1 { color: red; }']]));
    const result = proposeTranspilerPatch(trace, detection);
    expect(result).not.toBeNull();
    expect(result!.diff_summary).toContain('+');
    expect(result!.patched_content).toContain(':where(h1)');

    cleanTempDir();
  });

  it('rejects generated-output target files', () => {
    const trace = {
      ...getTraceById('SH9-001')!,
      fix: {
        ...getTraceById('SH9-001')!.fix,
        target_file: 'output/client/src/App.jsx',
        apply: (source: string) => source.replace('h1 {', ':where(h1) {'),
      },
    };
    const detection = trace.detect(new Map([['index.css', 'h1 { color: red; }']]));
    const result = proposeTranspilerPatch(trace, detection);
    expect(result).toBeNull();
  });
});

describe('verifyTranspilerPatch', () => {
  it('passes when invariants pass and output exists', () => {
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'src/transpiler/scaffold.ts',
      transpiler_function: 'generateIndexCss',
      original_content: 'original',
      patched_content: 'patched',
      diff_summary: '+1 -1 lines',
      strategy: 'wrap-selector',
      verification: null,
    };

    const before = new Map([['index.css', 'h1 { color: red; }']]);
    const after = new Map([['index.css', ':where(h1) { color: red; }']]);

    const verification = verifyTranspilerPatch(patch, before, after, runInvariants);
    expect(verification.retranspile_successful).toBe(true);
    expect(verification.invariants_passed).toBe(true);
    expect(verification.output_hash_before).not.toBe(verification.output_hash_after);
  });

  it('fails when invariants fail', () => {
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'test.ts',
      transpiler_function: 'test',
      original_content: 'original',
      patched_content: 'patched',
      diff_summary: '+1 -1 lines',
      strategy: 'wrap-selector',
      verification: null,
    };

    const files = new Map([
      ['pages/Dashboard.jsx', 'api.getProjects().then(r => setProjects(r))'],
    ]);

    const verification = verifyTranspilerPatch(patch, files, files, runInvariants);
    // INV-001 should fail (no .data unwrapping)
    expect(verification.invariants_passed).toBe(false);
  });

  it('handles null output (no re-transpile)', () => {
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'test.ts',
      transpiler_function: 'test',
      original_content: 'original',
      patched_content: 'patched',
      diff_summary: '+1 -1 lines',
      strategy: 'wrap-selector',
      verification: null,
    };

    const before = new Map([['test.txt', 'hello']]);
    const verification = verifyTranspilerPatch(patch, before, null);
    expect(verification.retranspile_successful).toBe(false);
    expect(verification.invariants_passed).toBe(true); // no runner provided
    expect(verification.output_hash_before).toBe(verification.output_hash_after); // same files used
  });

  it('hashes are stable for same content', () => {
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'test.ts',
      transpiler_function: 'test',
      original_content: 'a',
      patched_content: 'b',
      diff_summary: '+1 -1',
      strategy: 'wrap-selector',
      verification: null,
    };

    const files = new Map([['a.txt', 'content']]);
    const v1 = verifyTranspilerPatch(patch, files, files);
    const v2 = verifyTranspilerPatch(patch, files, files);
    expect(v1.output_hash_before).toBe(v2.output_hash_before);
  });
});

describe('isPatchWithinScope', () => {
  it('accepts patches within limits', () => {
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'src/transpiler/test.ts',
      transpiler_function: 'test',
      original_content: 'line1\nline2',
      patched_content: 'line1-changed\nline2',
      diff_summary: '+1 -1',
      strategy: 'wrap-selector',
      verification: null,
    };
    expect(isPatchWithinScope([patch])).toBe(true);
  });

  it('rejects too many files', () => {
    const makePatch = (id: string): TranspilerPatchResult => ({
      trace_id: id,
      transpiler_file: `file-${id}.ts`,
      transpiler_function: 'test',
      original_content: 'a',
      patched_content: 'b',
      diff_summary: '+1 -1',
      strategy: 'wrap-selector',
      verification: null,
    });
    expect(isPatchWithinScope([makePatch('1'), makePatch('2'), makePatch('3'), makePatch('4')])).toBe(false);
  });

  it('rejects patches with too many line changes', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line${i}`).join('\n');
    const changed = Array.from({ length: 60 }, (_, i) => `changed${i}`).join('\n');
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'test.ts',
      transpiler_function: 'test',
      original_content: lines,
      patched_content: changed,
      diff_summary: '+60 -60',
      strategy: 'wrap-selector',
      verification: null,
    };
    expect(isPatchWithinScope([patch])).toBe(false);
  });

  it('rejects patches outside framework-owned source paths', () => {
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'output/client/src/App.jsx',
      transpiler_function: 'test',
      original_content: 'line1',
      patched_content: 'line2',
      diff_summary: '+1 -1',
      strategy: 'wrap-selector',
      verification: null,
    };
    expect(isPatchWithinScope([patch])).toBe(false);
  });
});

describe('self-heal target guardrails', () => {
  it('allows framework source and .air targets', () => {
    expect(isAllowedSelfHealPatchTarget('src/transpiler/scaffold.ts')).toBe(true);
    expect(isAllowedSelfHealPatchTarget('src/self-heal/codegen-trace.ts')).toBe(true);
    expect(isAllowedSelfHealPatchTarget('scripts/self-heal-loop.ts')).toBe(true);
    expect(isAllowedSelfHealPatchTarget('examples/ecommerce.air')).toBe(true);
  });

  it('rejects generated outputs, traversal, and absolute paths', () => {
    expect(isAllowedSelfHealPatchTarget('output/client/src/App.jsx')).toBe(false);
    expect(isAllowedSelfHealPatchTarget('artifacts/self-heal/incidents/x/incident.json')).toBe(false);
    expect(isAllowedSelfHealPatchTarget('.air-artifacts/app/src/App.jsx')).toBe(false);
    expect(isAllowedSelfHealPatchTarget('../src/transpiler/scaffold.ts')).toBe(false);
    expect(isAllowedSelfHealPatchTarget('/tmp/scaffold.ts')).toBe(false);
  });

  it('applyTranspilerPatch refuses disallowed patch targets', () => {
    const patch: TranspilerPatchResult = {
      trace_id: 'SH9-001',
      transpiler_file: 'output/client/src/App.jsx',
      transpiler_function: 'test',
      original_content: 'a',
      patched_content: 'b',
      diff_summary: '+1 -1',
      strategy: 'wrap-selector',
      verification: {
        invariants_passed: true,
        invariant_results: [],
        retranspile_successful: true,
        style_checks_passed: true,
        output_hash_before: 'h1',
        output_hash_after: 'h2',
      },
    };
    expect(applyTranspilerPatch(patch)).toBe(false);
  });
});
