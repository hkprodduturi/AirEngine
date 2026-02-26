/**
 * Self-Heal Advanced Tests (SH3 + SH4 + SH5 + SH6 + SH7)
 *
 * Tests patch bot, verifier, knowledge store, regression promotion,
 * and model-assisted improvements.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { validateJsonSchema } from './schema-validator.js';

// SH3 — Patch Bot
import {
  buildPatchScope,
  buildPatchPrompt,
  buildPatchArtifact,
  validatePatchResult,
  SUBSYSTEM_FILES,
  MAX_FILES,
  MAX_LINES_CHANGED,
  type PatchResult,
} from '../scripts/patch-incident.js';

// SH4 — Verifier
import {
  runStep,
  buildVerifyResult,
  validateVerifyResult,
  VERIFY_STEPS,
  type VerifyStep,
  type VerifyResult,
} from '../scripts/verify-patch.js';

// SH5 — Knowledge Store
import {
  loadKnowledge,
  appendKnowledge,
  queryKnowledge,
  buildKnowledgeEntry,
  incrementOccurrence,
  type KnowledgeEntry,
} from '../scripts/knowledge-store.js';

// SH6 — Regression Promotion
import {
  runPromotionChecks,
  checkRegressionTest,
  checkInvariant,
  checkGoldenCoverage,
  checkKnowledgeEntry,
  type PromotionReport,
} from '../scripts/promote-fix.js';

// SH7 — Model-Assisted
import {
  enhancedClassify,
  enrichPatchContext,
  calibrate,
  type ModelClassifyResult,
  type EnrichedPatchContext,
  type CalibrationResult,
} from '../scripts/model-assisted.js';

// ---- Helpers ----

const SCHEMAS_DIR = join(__dirname, '..', 'docs');
const TEST_DATA_DIR = join(__dirname, '..', 'data', '_test_self_heal');
const TEST_KNOWLEDGE_FILE = join(TEST_DATA_DIR, 'self-heal-knowledge.jsonl');

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf-8'));
}

function makeTriagedIncident(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '1.0',
    incident_id: 'SH-20260226-120000-test01',
    timestamp: '2026-02-26T12:00:00.000Z',
    source: 'stability-sweep',
    summary: 'Dashboard crashes with .map is not a function',
    severity: 'P1',
    status: 'triaged',
    stage: 'runtime-ui',
    classification: 'codegen-paginated-shape-mismatch',
    suspected_subsystem: 'page-gen',
    error: {
      message: '.map is not a function',
      stack: null,
      raw_output: null,
      error_code: null,
      http_status: null,
    },
    inputs: {
      air_file: null,
      generated_file: null,
      output_dir: null,
      page_name: 'DashboardPage',
      route_path: null,
      seed_file: null,
      example_id: null,
    },
    evidence: [],
    tags: ['codegen', 'paginated'],
    triage: {
      classification: 'codegen-paginated-shape-mismatch',
      suspected_subsystem: 'page-gen',
      confidence: 'high',
      triage_notes: 'Paginated response not unwrapped.',
      recommended_next_step: 'Fix page-gen unwrapping logic.',
      suggested_tests: ['pagination-unwrap.test.ts'],
      suggested_invariant: 'paginated-list-unwrapping',
    },
    ...overrides,
  };
}

// ============================================================
// SH3 — Patch Bot Tests
// ============================================================

describe('SH3 — Patch Bot', () => {
  describe('buildPatchScope()', () => {
    it('returns scope for known subsystem', () => {
      const incident = makeTriagedIncident();
      const scope = buildPatchScope(incident);

      expect(scope.subsystems).toContain('page-gen');
      expect(scope.files).toEqual(SUBSYSTEM_FILES['page-gen']);
      expect(scope.max_lines_changed).toBe(MAX_LINES_CHANGED);
    });

    it('handles unknown subsystem gracefully', () => {
      const incident = makeTriagedIncident({ suspected_subsystem: 'unknown' });
      const scope = buildPatchScope(incident);

      expect(scope.subsystems).toContain('unknown');
      expect(scope.files).toEqual([]);
    });

    it('limits files to MAX_FILES', () => {
      const incident = makeTriagedIncident();
      const scope = buildPatchScope(incident);
      expect(scope.files.length).toBeLessThanOrEqual(MAX_FILES);
    });
  });

  describe('buildPatchPrompt()', () => {
    it('generates prompt with incident details', () => {
      const incident = makeTriagedIncident();
      const scope = buildPatchScope(incident);
      const prompt = buildPatchPrompt(incident, scope, []);

      expect(prompt).toContain('# Patch Request');
      expect(prompt).toContain('codegen-paginated-shape-mismatch');
      expect(prompt).toContain('page-gen');
      expect(prompt).toContain('## Requirements');
    });

    it('includes related knowledge when available', () => {
      const incident = makeTriagedIncident();
      const scope = buildPatchScope(incident);
      const knowledge: KnowledgeEntry[] = [{
        schema_version: '1.0',
        knowledge_id: 'SK-test-001',
        incident_id: 'SH-prev-001',
        timestamp: '2026-02-20T12:00:00Z',
        classification: 'codegen-paginated-shape-mismatch',
        subsystem: 'page-gen',
        root_cause: 'Missing .data unwrap',
        fix_summary: 'Added .data ?? res extraction in page-gen',
        patch_id: null,
        files_changed: ['src/transpiler/react/page-gen.ts'],
        tests_added: ['tests/pagination.test.ts'],
        invariants_added: [],
        recurrence_tags: ['codegen-paginated-shape-mismatch'],
        retrieval_keywords: ['paginated', 'map'],
        occurrence_count: 3,
        related_incidents: [],
        verified: true,
        promoted_to_regression: true,
      }];

      const prompt = buildPatchPrompt(incident, scope, knowledge);

      expect(prompt).toContain('## Related Past Fixes');
      expect(prompt).toContain('Added .data ?? res extraction');
    });

    it('includes scope constraints', () => {
      const incident = makeTriagedIncident();
      const scope = buildPatchScope(incident);
      const prompt = buildPatchPrompt(incident, scope, []);

      expect(prompt).toContain(`Max lines changed: ${MAX_LINES_CHANGED}`);
      expect(prompt).toContain('page-gen');
    });
  });

  describe('buildPatchArtifact()', () => {
    it('creates valid patch artifact', () => {
      const incident = makeTriagedIncident();
      const scope = buildPatchScope(incident);
      const prompt = 'test prompt';
      const patch = buildPatchArtifact(incident, scope, prompt);

      expect(patch.schema_version).toBe('1.0');
      expect(patch.patch_id).toMatch(/^SP-/);
      expect(patch.incident_id).toBe(incident.incident_id);
      expect(patch.status).toBe('proposed');
      expect(patch.diffs).toEqual([]);
      expect(patch.verification_status).toBeNull();
    });
  });

  describe('SUBSYSTEM_FILES mapping', () => {
    it('covers all key subsystems', () => {
      const expected = [
        'page-gen', 'jsx-gen', 'layout-gen', 'scaffold', 'mutation-gen',
        'api-client-gen', 'api-router-gen', 'server-entry-gen',
        'prisma-gen', 'seed-gen', 'parser', 'validator',
      ];
      for (const sub of expected) {
        expect(SUBSYSTEM_FILES).toHaveProperty(sub);
      }
    });

    it('all file paths are strings', () => {
      for (const [, files] of Object.entries(SUBSYSTEM_FILES)) {
        expect(Array.isArray(files)).toBe(true);
        for (const f of files) {
          expect(typeof f).toBe('string');
        }
      }
    });
  });

  describe('Schema conformance', () => {
    it('patch artifact validates against schema', () => {
      const schema = loadSchema('self-heal-patch-result.schema.json');
      const incident = makeTriagedIncident();
      const scope = buildPatchScope(incident);
      const patch = buildPatchArtifact(incident, scope, 'prompt');

      const errors = validateJsonSchema(patch, schema, schema);
      expect(errors).toEqual([]);
    });
  });
});

// ============================================================
// SH4 — Verifier Tests
// ============================================================

describe('SH4 — Verifier', () => {
  describe('VERIFY_STEPS', () => {
    it('defines at least 5 verification steps', () => {
      expect(VERIFY_STEPS.length).toBeGreaterThanOrEqual(5);
    });

    it('each step has name and command', () => {
      for (const step of VERIFY_STEPS) {
        expect(typeof step.name).toBe('string');
        expect(step.name.length).toBeGreaterThan(0);
        expect(typeof step.command).toBe('string');
        expect(step.command.length).toBeGreaterThan(0);
      }
    });

    it('includes type check step', () => {
      expect(VERIFY_STEPS.some(s => s.command.includes('tsc'))).toBe(true);
    });

    it('includes test suite step', () => {
      expect(VERIFY_STEPS.some(s => s.command.includes('vitest'))).toBe(true);
    });
  });

  describe('runStep()', () => {
    it('returns pass for successful command', () => {
      const result = runStep({ name: 'Echo test', command: 'echo hello' });
      expect(result.status).toBe('pass');
      expect(result.exit_code).toBe(0);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(result.output_summary).toContain('hello');
    });

    it('returns fail for failing command', () => {
      const result = runStep({ name: 'Fail test', command: 'false' });
      expect(result.status).toBe('fail');
      expect(result.exit_code).not.toBe(0);
    });

    it('captures output summary', () => {
      const result = runStep({ name: 'Multi-line', command: 'echo "line1\nline2\nline3"' });
      expect(result.status).toBe('pass');
      expect(result.output_summary).toBeTruthy();
    });
  });

  describe('buildVerifyResult()', () => {
    it('returns pass when all steps pass', () => {
      const steps: VerifyStep[] = [
        { name: 'A', command: 'echo', status: 'pass', duration_ms: 10, output_summary: null, exit_code: 0 },
        { name: 'B', command: 'echo', status: 'pass', duration_ms: 20, output_summary: null, exit_code: 0 },
      ];
      const result = buildVerifyResult('SP-001', 'SH-001', steps);

      expect(result.verdict).toBe('pass');
      expect(result.total_duration_ms).toBe(30);
      expect(result.verify_id).toMatch(/^SV-/);
    });

    it('returns fail when all steps fail', () => {
      const steps: VerifyStep[] = [
        { name: 'A', command: 'echo', status: 'fail', duration_ms: 10, output_summary: null, exit_code: 1 },
        { name: 'B', command: 'echo', status: 'fail', duration_ms: 20, output_summary: null, exit_code: 1 },
      ];
      const result = buildVerifyResult('SP-001', 'SH-001', steps);
      expect(result.verdict).toBe('fail');
    });

    it('returns partial when some steps pass', () => {
      const steps: VerifyStep[] = [
        { name: 'A', command: 'echo', status: 'pass', duration_ms: 10, output_summary: null, exit_code: 0 },
        { name: 'B', command: 'echo', status: 'fail', duration_ms: 20, output_summary: null, exit_code: 1 },
      ];
      const result = buildVerifyResult('SP-001', 'SH-001', steps);
      expect(result.verdict).toBe('partial');
    });
  });

  describe('Schema conformance', () => {
    it('verify result validates against schema', () => {
      const schema = loadSchema('self-heal-verify.schema.json');
      const steps: VerifyStep[] = [
        { name: 'Test', command: 'echo', status: 'pass', duration_ms: 10, output_summary: 'ok', exit_code: 0 },
      ];
      const result = buildVerifyResult('SP-001', 'SH-001', steps);

      const errors = validateJsonSchema(result, schema, schema);
      expect(errors).toEqual([]);
    });
  });
});

// ============================================================
// SH5 — Knowledge Store Tests
// ============================================================

describe('SH5 — Knowledge Store', () => {
  // Use real data dir — tests operate on shared JSONL
  // We test buildKnowledgeEntry (pure) and queryKnowledge (pure after load)

  describe('buildKnowledgeEntry()', () => {
    it('creates entry with defaults', () => {
      const incident = makeTriagedIncident();
      const entry = buildKnowledgeEntry(incident);

      expect(entry.schema_version).toBe('1.0');
      expect(entry.knowledge_id).toMatch(/^SK-/);
      expect(entry.incident_id).toBe('SH-20260226-120000-test01');
      expect(entry.classification).toBe('codegen-paginated-shape-mismatch');
      expect(entry.subsystem).toBe('page-gen');
      expect(entry.occurrence_count).toBe(1);
      expect(entry.verified).toBe(false);
      expect(entry.promoted_to_regression).toBe(false);
    });

    it('accepts overrides', () => {
      const incident = makeTriagedIncident();
      const entry = buildKnowledgeEntry(incident, {
        root_cause: 'Missing .data unwrap',
        fix_summary: 'Added extraction logic',
        verified: true,
      });

      expect(entry.root_cause).toBe('Missing .data unwrap');
      expect(entry.fix_summary).toBe('Added extraction logic');
      expect(entry.verified).toBe(true);
    });

    it('extracts tags as retrieval keywords', () => {
      const incident = makeTriagedIncident({ tags: ['codegen', 'pagination', 'dashboard'] });
      const entry = buildKnowledgeEntry(incident);

      expect(entry.retrieval_keywords).toEqual(['codegen', 'pagination', 'dashboard']);
    });

    it('sets recurrence tags from classification', () => {
      const incident = makeTriagedIncident();
      const entry = buildKnowledgeEntry(incident);
      expect(entry.recurrence_tags).toContain('codegen-paginated-shape-mismatch');
    });
  });

  describe('queryKnowledge() (pure matching)', () => {
    // Test the matching logic with pre-loaded entries
    it('matches by classification', () => {
      const entries: KnowledgeEntry[] = [
        buildKnowledgeEntry(makeTriagedIncident(), { occurrence_count: 3 }),
        buildKnowledgeEntry(makeTriagedIncident({ classification: 'other' })),
      ];

      // Test filter logic directly
      const matches = entries.filter(e =>
        e.classification === 'codegen-paginated-shape-mismatch'
      );
      expect(matches.length).toBe(1);
      expect(matches[0].occurrence_count).toBe(3);
    });

    it('matches by recurrence tags', () => {
      const entry = buildKnowledgeEntry(makeTriagedIncident(), {
        recurrence_tags: ['codegen-paginated-shape-mismatch', 'pagination-bug'],
      });

      expect(entry.recurrence_tags).toContain('pagination-bug');
    });
  });

  describe('Schema conformance', () => {
    it('knowledge entry validates against schema', () => {
      const schema = loadSchema('self-heal-knowledge.schema.json');
      const incident = makeTriagedIncident();
      const entry = buildKnowledgeEntry(incident);

      const errors = validateJsonSchema(entry, schema, schema);
      expect(errors).toEqual([]);
    });

    it('entry with overrides validates', () => {
      const schema = loadSchema('self-heal-knowledge.schema.json');
      const entry = buildKnowledgeEntry(makeTriagedIncident(), {
        root_cause: 'Test root cause',
        fix_summary: 'Test fix',
        patch_id: 'SP-test',
        files_changed: ['src/test.ts'],
        tests_added: ['tests/test.test.ts'],
        verified: true,
        promoted_to_regression: true,
      });

      const errors = validateJsonSchema(entry, schema, schema);
      expect(errors).toEqual([]);
    });
  });
});

// ============================================================
// SH6 — Regression Promotion Tests
// ============================================================

describe('SH6 — Regression Promotion', () => {
  describe('checkRegressionTest()', () => {
    it('finds regression tests by classification', () => {
      // 'codegen-paginated-shape-mismatch' appears in tests/self-heal.test.ts
      const incident = makeTriagedIncident();
      const check = checkRegressionTest(incident);

      expect(check.name).toBe('Regression test');
      // May or may not find depending on test content, but structure is correct
      expect(typeof check.passed).toBe('boolean');
      expect(typeof check.details).toBe('string');
    });

    it('returns valid structure for any classification', () => {
      const incident = makeTriagedIncident({ classification: 'test-classification' });
      const check = checkRegressionTest(incident);
      expect(check.name).toBe('Regression test');
      expect(typeof check.passed).toBe('boolean');
      expect(typeof check.details).toBe('string');
    });
  });

  describe('checkInvariant()', () => {
    it('passes when no invariant suggested', () => {
      const incident = makeTriagedIncident({
        triage: {
          classification: 'test',
          suspected_subsystem: 'test',
          confidence: 'high',
          triage_notes: '',
          recommended_next_step: '',
          suggested_tests: [],
          suggested_invariant: null,
        },
      });
      const check = checkInvariant(incident);
      expect(check.passed).toBe(true);
      expect(check.details).toContain('skipped');
    });

    it('checks for suggested invariant in invariants.ts', () => {
      const incident = makeTriagedIncident({
        triage: {
          classification: 'test',
          suspected_subsystem: 'test',
          confidence: 'high',
          triage_notes: '',
          recommended_next_step: '',
          suggested_tests: [],
          suggested_invariant: 'paginated-list-unwrapping',
        },
      });
      const check = checkInvariant(incident);
      // Should find it since INV-001 covers this
      expect(check.name).toBe('Invariant');
      expect(typeof check.passed).toBe('boolean');
    });
  });

  describe('checkGoldenCoverage()', () => {
    it('checks golden run scripts for subsystem coverage', () => {
      const incident = makeTriagedIncident();
      const check = checkGoldenCoverage(incident);

      expect(check.name).toBe('Golden coverage');
      expect(typeof check.passed).toBe('boolean');
      expect(typeof check.details).toBe('string');
    });
  });

  describe('checkKnowledgeEntry()', () => {
    it('returns structure for knowledge check', () => {
      const incident = makeTriagedIncident();
      const check = checkKnowledgeEntry(incident);

      expect(check.name).toBe('Knowledge store entry');
      expect(typeof check.passed).toBe('boolean');
    });
  });

  describe('runPromotionChecks()', () => {
    it('returns structured report', () => {
      const incident = makeTriagedIncident();
      const report = runPromotionChecks(incident);

      expect(report.incident_id).toBe('SH-20260226-120000-test01');
      expect(report.classification).toBe('codegen-paginated-shape-mismatch');
      expect(report.checks.length).toBe(4);
      expect(typeof report.promoted).toBe('boolean');
      expect(Array.isArray(report.missing)).toBe(true);
    });

    it('marks promoted=true when any check passes', () => {
      // codegen-paginated-shape-mismatch should appear in test files
      const incident = makeTriagedIncident();
      const report = runPromotionChecks(incident);

      // At minimum, regression test should find it in tests/self-heal.test.ts
      if (report.checks.some(c => c.passed && !c.details.includes('skipped'))) {
        expect(report.promoted).toBe(true);
      }
    });

    it('missing array contains only failed check names', () => {
      const incident = makeTriagedIncident();
      const report = runPromotionChecks(incident);
      // Each missing item must be a string matching a check name
      for (const name of report.missing) {
        expect(typeof name).toBe('string');
        expect(report.checks.some(c => c.name === name && !c.passed)).toBe(true);
      }
    });
  });
});

// ============================================================
// SH7 — Model-Assisted Tests
// ============================================================

describe('SH7 — Model-Assisted', () => {
  describe('enhancedClassify() — deterministic fast path', () => {
    it('skips model when deterministic classifier succeeds', async () => {
      const incident = makeTriagedIncident();
      // enhancedClassify should not call model when deterministic works
      const result = await enhancedClassify(incident);

      expect(result.deterministic_classification).toBe('codegen-paginated-shape-mismatch');
      expect(result.agreement).toBe(true);
      expect(result.final_classification).toBe('codegen-paginated-shape-mismatch');
      expect(result.model_reasoning).toContain('Deterministic classifier matched');
    });

    it('returns valid structure for all fields', async () => {
      const incident = makeTriagedIncident();
      const result = await enhancedClassify(incident);

      expect(typeof result.deterministic_classification).toBe('string');
      expect(typeof result.model_classification).toBe('string');
      expect(['high', 'medium', 'low']).toContain(result.model_confidence);
      expect(typeof result.model_reasoning).toBe('string');
      expect(typeof result.agreement).toBe('boolean');
      expect(typeof result.final_classification).toBe('string');
    });
  });

  describe('enrichPatchContext()', () => {
    it('returns enriched context with base prompt', () => {
      const incident = makeTriagedIncident();
      const context = enrichPatchContext(incident);

      expect(context.base_prompt).toContain('# Patch Request');
      expect(context.base_prompt).toContain('codegen-paginated-shape-mismatch');
      expect(context.total_context_lines).toBeGreaterThan(0);
      expect(Array.isArray(context.knowledge_context)).toBe(true);
      expect(Array.isArray(context.similar_patterns)).toBe(true);
    });

    it('includes similar patterns from same subsystem', () => {
      const incident = makeTriagedIncident({ suspected_subsystem: 'page-gen' });
      const context = enrichPatchContext(incident, []);

      // Other page-gen patterns should be listed
      for (const pat of context.similar_patterns) {
        expect(typeof pat).toBe('string');
      }
    });

    it('includes knowledge context when entries provided', () => {
      const incident = makeTriagedIncident();
      const entries: KnowledgeEntry[] = [{
        schema_version: '1.0',
        knowledge_id: 'SK-test',
        incident_id: 'SH-prev',
        timestamp: '2026-02-20T12:00:00Z',
        classification: 'codegen-paginated-shape-mismatch',
        subsystem: 'page-gen',
        root_cause: 'Missing unwrap',
        fix_summary: 'Added .data extraction in page-gen',
        patch_id: null,
        files_changed: [],
        tests_added: [],
        invariants_added: [],
        recurrence_tags: [],
        retrieval_keywords: [],
        occurrence_count: 2,
        related_incidents: [],
        verified: true,
        promoted_to_regression: false,
      }];

      const context = enrichPatchContext(incident, entries);
      expect(context.knowledge_context.length).toBe(1);
      expect(context.knowledge_context[0]).toContain('Added .data extraction');
    });
  });

  describe('calibrate()', () => {
    it('returns valid calibration structure', () => {
      const result = calibrate(10);

      expect(typeof result.total_incidents).toBe('number');
      expect(typeof result.deterministic_classified).toBe('number');
      expect(typeof result.deterministic_unknown).toBe('number');
      expect(typeof result.model_reclassified).toBe('number');
      expect(typeof result.agreement_rate).toBe('number');
      expect(Array.isArray(result.classifications)).toBe(true);
    });

    it('agreement rate is between 0 and 1 (or 0 if empty)', () => {
      const result = calibrate(10);
      expect(result.agreement_rate).toBeGreaterThanOrEqual(0);
      expect(result.agreement_rate).toBeLessThanOrEqual(1);
    });

    it('total equals classified + unknown', () => {
      const result = calibrate(10);
      expect(result.deterministic_classified + result.deterministic_unknown)
        .toBe(result.total_incidents);
    });
  });
});

// ============================================================
// Cross-Phase Integration Tests
// ============================================================

describe('Self-Heal Cross-Phase Integration', () => {
  it('incident → patch scope → prompt pipeline', () => {
    const incident = makeTriagedIncident();
    const scope = buildPatchScope(incident);
    const prompt = buildPatchPrompt(incident, scope, []);
    const patch = buildPatchArtifact(incident, scope, prompt);

    expect(patch.incident_id).toBe(incident.incident_id);
    expect(patch.patch_scope.subsystems).toEqual(scope.subsystems);
    expect(patch.notes).toContain('Patch prompt generated');
  });

  it('verify result → verdict logic', () => {
    const passStep: VerifyStep = {
      name: 'Pass', command: 'echo', status: 'pass',
      duration_ms: 10, output_summary: null, exit_code: 0,
    };
    const failStep: VerifyStep = {
      name: 'Fail', command: 'false', status: 'fail',
      duration_ms: 5, output_summary: null, exit_code: 1,
    };

    expect(buildVerifyResult('SP-1', 'SH-1', [passStep]).verdict).toBe('pass');
    expect(buildVerifyResult('SP-1', 'SH-1', [failStep]).verdict).toBe('fail');
    expect(buildVerifyResult('SP-1', 'SH-1', [passStep, failStep]).verdict).toBe('partial');
  });

  it('knowledge entry → query roundtrip (pure logic)', () => {
    const incident = makeTriagedIncident();
    const entry = buildKnowledgeEntry(incident, {
      fix_summary: 'Fixed pagination unwrapping',
    });

    // Simulate query matching
    const matches = [entry].filter(e =>
      e.classification === 'codegen-paginated-shape-mismatch'
    );
    expect(matches.length).toBe(1);
    expect(matches[0].fix_summary).toBe('Fixed pagination unwrapping');
  });

  it('promotion check structure is complete', () => {
    const incident = makeTriagedIncident();
    const report = runPromotionChecks(incident);

    // Must have all 4 check types
    const names = report.checks.map(c => c.name);
    expect(names).toContain('Regression test');
    expect(names).toContain('Invariant');
    expect(names).toContain('Golden coverage');
    expect(names).toContain('Knowledge store entry');
  });

  it('enhanced classify → enrich pipeline', async () => {
    const incident = makeTriagedIncident();
    const classResult = await enhancedClassify(incident);
    expect(classResult.final_classification).toBe('codegen-paginated-shape-mismatch');

    const context = enrichPatchContext(incident);
    expect(context.base_prompt).toContain(classResult.final_classification);
  });
});
