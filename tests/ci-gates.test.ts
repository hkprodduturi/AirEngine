/**
 * A4c CI + Budget Gates Tests
 *
 * Tests for eval-online-compare.ts (regression comparator) and
 * quality-gate.ts (unified gate runner logic). All network-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import {
  loadReport,
  checkCorpusMatch,
  compareRates,
  compareTiming,
  compareTokens,
  compareFailures,
  compareReports,
} from '../scripts/eval-online-compare.js';
import type { OnlineEvalReportFile, OnlineEvalMetrics, ComparePolicy } from '../scripts/eval-online-compare.js';
import {
  runStep,
  skipStep,
  summarizeSteps,
  resolveMode,
  buildGateReport,
} from '../scripts/quality-gate.js';
import type { GateStep, QualityGateReport } from '../scripts/quality-gate.js';
import { validateJsonSchema } from './schema-validator.js';

// ---- Helpers ----

const TMP_DIR = join(__dirname, '..', 'artifacts', 'test-tmp');
const GATE_SCHEMA_PATH = join(__dirname, '..', 'docs', 'quality-gate-result.schema.json');

function makeMetrics(overrides: Partial<OnlineEvalMetrics> = {}): OnlineEvalMetrics {
  return {
    total_cases: 10,
    completed_cases: 10,
    success_count: 8,
    prompt_to_air_success_rate: 0.9,
    prompt_to_running_app_success_rate: 0.8,
    timing: {
      avg_total_ms: 5000,
      p50_total_ms: 4500,
      p95_total_ms: 8000,
      avg_generation_ms: 3000,
      avg_loop_ms: 2000,
    },
    tokens: {
      total_input: 5000,
      total_output: 2000,
      avg_input: 500,
      avg_output: 200,
    },
    retries: {
      avg_generation_attempts: 1.2,
      avg_repair_attempts: 0.3,
    },
    failure_breakdown: {
      success_running_app: 8,
      generation_failed_auth: 0,
      generation_failed_provider: 0,
      generation_failed_invalid_air: 1,
      loop_failed_validation: 0,
      loop_failed_repair: 0,
      loop_failed_transpile: 1,
      loop_failed_smoke: 0,
      loop_failed_determinism: 0,
      unexpected_error: 0,
    },
    ...overrides,
  };
}

function makeReport(overrides: Partial<OnlineEvalReportFile> = {}): OnlineEvalReportFile {
  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    corpus: {
      corpus_id: 'online-eval-v1',
      total_entries: 10,
      limit_applied: null,
    },
    metrics: makeMetrics(),
    config: { generator_model: 'claude-sonnet-4-20250514', repair_mode: 'deterministic', max_repair_attempts: 1, timeout_ms: 30000, provider_retries: 2 },
    ...overrides,
  };
}

function writeTmpReport(name: string, report: OnlineEvalReportFile): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, name);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

// Cleanup after all tests
import { afterAll } from 'vitest';
afterAll(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// ============================================================
// Online Eval Comparator Tests
// ============================================================

describe('eval-online-compare', () => {
  describe('loadReport', () => {
    it('loads a valid report', () => {
      const path = writeTmpReport('valid.json', makeReport());
      const report = loadReport(path);
      expect(report.schema_version).toBe('1.0');
      expect(report.metrics.prompt_to_running_app_success_rate).toBe(0.8);
    });

    it('rejects report with wrong schema_version', () => {
      const path = writeTmpReport('bad-version.json', makeReport({ schema_version: '2.0' } as OnlineEvalReportFile));
      expect(() => loadReport(path)).toThrow('Unsupported schema_version');
    });

    it('rejects report missing metrics', () => {
      const path = writeTmpReport('no-metrics.json', { schema_version: '1.0' } as OnlineEvalReportFile);
      expect(() => loadReport(path)).toThrow('missing metrics');
    });
  });

  describe('checkCorpusMatch', () => {
    it('returns match for identical corpus configs', () => {
      const a = makeReport();
      const b = makeReport();
      expect(checkCorpusMatch(a, b).match).toBe(true);
    });

    it('detects corpus_id mismatch', () => {
      const a = makeReport();
      const b = makeReport({ corpus: { ...a.corpus, corpus_id: 'different' } });
      const result = checkCorpusMatch(a, b);
      expect(result.match).toBe(false);
      expect(result.reason).toContain('corpus_id mismatch');
    });

    it('detects total_entries mismatch', () => {
      const a = makeReport();
      const b = makeReport({ corpus: { ...a.corpus, total_entries: 5 } });
      expect(checkCorpusMatch(a, b).match).toBe(false);
    });

    it('detects effective limit mismatch', () => {
      const a = makeReport({ corpus: { corpus_id: 'online-eval-v1', total_entries: 10, limit_applied: 3 } });
      const b = makeReport({ corpus: { corpus_id: 'online-eval-v1', total_entries: 10, limit_applied: 5 } });
      const result = checkCorpusMatch(a, b);
      expect(result.match).toBe(false);
      expect(result.reason).toContain('effective limit mismatch');
    });
  });

  describe('compareRates', () => {
    it('detects no regression when rates are equal', () => {
      const m = makeMetrics();
      const rates = compareRates(m, m, { success_rate_threshold: 0.1, air_rate_threshold: 0.1 } as ComparePolicy);
      expect(rates.every(r => !r.hard)).toBe(true);
      expect(rates.every(r => !r.regression)).toBe(true);
    });

    it('detects hard regression on north-star drop > threshold', () => {
      const prev = makeMetrics({ prompt_to_running_app_success_rate: 0.8 });
      const curr = makeMetrics({ prompt_to_running_app_success_rate: 0.5 });
      const rates = compareRates(prev, curr, { success_rate_threshold: 0.1, air_rate_threshold: 0.1 } as ComparePolicy);
      const ns = rates.find(r => r.name === 'prompt_to_running_app_success_rate')!;
      expect(ns.hard).toBe(true);
      expect(ns.regression).toBe(true);
      expect(ns.delta).toBeCloseTo(-0.3, 2);
    });

    it('soft regression when drop is within threshold', () => {
      const prev = makeMetrics({ prompt_to_running_app_success_rate: 0.8 });
      const curr = makeMetrics({ prompt_to_running_app_success_rate: 0.75 });
      const rates = compareRates(prev, curr, { success_rate_threshold: 0.1, air_rate_threshold: 0.1 } as ComparePolicy);
      const ns = rates.find(r => r.name === 'prompt_to_running_app_success_rate')!;
      expect(ns.regression).toBe(true);
      expect(ns.hard).toBe(false);
    });

    it('no regression when rate improves', () => {
      const prev = makeMetrics({ prompt_to_running_app_success_rate: 0.6 });
      const curr = makeMetrics({ prompt_to_running_app_success_rate: 0.9 });
      const rates = compareRates(prev, curr, { success_rate_threshold: 0.1, air_rate_threshold: 0.1 } as ComparePolicy);
      const ns = rates.find(r => r.name === 'prompt_to_running_app_success_rate')!;
      expect(ns.regression).toBe(false);
      expect(ns.hard).toBe(false);
    });
  });

  describe('compareTiming', () => {
    it('detects no regression when timing is stable', () => {
      const m = makeMetrics();
      const timing = compareTiming(m, m, { timing_ratio_threshold: 2.0, timing_min_abs_ms: 1000 } as ComparePolicy);
      expect(timing.every(t => !t.regression)).toBe(true);
    });

    it('detects hard timing regression (2x + abs threshold)', () => {
      const prev = makeMetrics({ timing: { avg_total_ms: 3000, p50_total_ms: 2500, p95_total_ms: 5000, avg_generation_ms: 2000, avg_loop_ms: 1000 } });
      const curr = makeMetrics({ timing: { avg_total_ms: 9000, p50_total_ms: 8000, p95_total_ms: 15000, avg_generation_ms: 6000, avg_loop_ms: 3000 } });
      const timing = compareTiming(prev, curr, { timing_ratio_threshold: 2.0, timing_min_abs_ms: 1000 } as ComparePolicy);
      const avg = timing.find(t => t.name === 'avg_total_ms')!;
      expect(avg.regression).toBe(true);
      expect(avg.hard).toBe(true);
      expect(avg.ratio).toBe(3);
    });

    it('ignores timing delta below min abs threshold', () => {
      const prev = makeMetrics({ timing: { avg_total_ms: 100, p50_total_ms: 90, p95_total_ms: 200, avg_generation_ms: 80, avg_loop_ms: 20 } });
      const curr = makeMetrics({ timing: { avg_total_ms: 300, p50_total_ms: 270, p95_total_ms: 600, avg_generation_ms: 240, avg_loop_ms: 60 } });
      const timing = compareTiming(prev, curr, { timing_ratio_threshold: 2.0, timing_min_abs_ms: 1000 } as ComparePolicy);
      // 3x ratio but delta < 1000ms, so no hard regression
      expect(timing.every(t => !t.regression)).toBe(true);
    });
  });

  describe('compareTokens', () => {
    it('flags warning when tokens double', () => {
      const prev = makeMetrics({ tokens: { total_input: 5000, total_output: 2000, avg_input: 500, avg_output: 200 } });
      const curr = makeMetrics({ tokens: { total_input: 10000, total_output: 4000, avg_input: 1000, avg_output: 400 } });
      const tokens = compareTokens(prev, curr, { token_ratio_threshold: 2.0 } as ComparePolicy);
      expect(tokens.some(t => t.warning)).toBe(true);
    });

    it('no warning when tokens are stable', () => {
      const m = makeMetrics();
      const tokens = compareTokens(m, m, { token_ratio_threshold: 2.0 } as ComparePolicy);
      expect(tokens.every(t => !t.warning)).toBe(true);
    });
  });

  describe('compareFailures', () => {
    it('computes deltas for all categories', () => {
      const prev = makeMetrics();
      const curr = makeMetrics({
        failure_breakdown: {
          ...makeMetrics().failure_breakdown,
          generation_failed_invalid_air: 3,
          loop_failed_transpile: 0,
        },
      });
      const deltas = compareFailures(prev, curr);
      const airDelta = deltas.find(d => d.category === 'generation_failed_invalid_air')!;
      expect(airDelta.delta).toBe(2);
      const transpileDelta = deltas.find(d => d.category === 'loop_failed_transpile')!;
      expect(transpileDelta.delta).toBe(-1);
    });
  });

  describe('compareReports (integration)', () => {
    it('self-compare produces pass verdict', () => {
      const path = writeTmpReport('self.json', makeReport());
      const result = compareReports(path, path);
      expect(result.verdict).toBe('pass');
      expect(result.hard_regressions).toHaveLength(0);
      expect(result.corpus_match).toBe(true);
    });

    it('detects north-star regression', () => {
      const prevPath = writeTmpReport('prev-ns.json', makeReport({
        metrics: makeMetrics({ prompt_to_running_app_success_rate: 0.8 }),
      }));
      const currPath = writeTmpReport('curr-ns.json', makeReport({
        metrics: makeMetrics({ prompt_to_running_app_success_rate: 0.5 }),
      }));
      const result = compareReports(prevPath, currPath);
      expect(result.verdict).toBe('fail');
      expect(result.hard_regressions.length).toBeGreaterThan(0);
      expect(result.hard_regressions[0]).toContain('prompt_to_running_app_success_rate');
    });

    it('corpus mismatch is soft warning by default', () => {
      const prevPath = writeTmpReport('prev-corpus.json', makeReport());
      const currPath = writeTmpReport('curr-corpus.json', makeReport({
        corpus: { corpus_id: 'different', total_entries: 10, limit_applied: null },
      }));
      const result = compareReports(prevPath, currPath);
      expect(result.corpus_match).toBe(false);
      expect(result.soft_warnings.some(w => w.includes('corpus mismatch'))).toBe(true);
      // Not a hard fail by default
      expect(result.hard_regressions.every(r => !r.includes('corpus'))).toBe(true);
    });

    it('corpus mismatch is hard fail with strict flag', () => {
      const prevPath = writeTmpReport('prev-strict.json', makeReport());
      const currPath = writeTmpReport('curr-strict.json', makeReport({
        corpus: { corpus_id: 'different', total_entries: 10, limit_applied: null },
      }));
      const result = compareReports(prevPath, currPath, { strict_corpus: true });
      expect(result.hard_regressions.some(r => r.includes('corpus mismatch'))).toBe(true);
      expect(result.verdict).toBe('fail');
    });

    it('threshold overrides change regression detection', () => {
      const prevPath = writeTmpReport('prev-thresh.json', makeReport({
        metrics: makeMetrics({ prompt_to_running_app_success_rate: 0.8 }),
      }));
      const currPath = writeTmpReport('curr-thresh.json', makeReport({
        metrics: makeMetrics({ prompt_to_running_app_success_rate: 0.5 }),
      }));
      // With very high threshold (0.5), a 0.3 drop is within tolerance
      const result = compareReports(prevPath, currPath, { success_rate_threshold: 0.5 });
      expect(result.verdict).toBe('pass');
    });

    it('produces human_summary string', () => {
      const path = writeTmpReport('summary.json', makeReport());
      const result = compareReports(path, path);
      expect(typeof result.human_summary).toBe('string');
      expect(result.human_summary).toContain('PASS');
      expect(result.human_summary).toContain('Success Rates');
    });
  });
});

// ============================================================
// Quality Gate Runner Tests
// ============================================================

describe('quality-gate', () => {
  describe('resolveMode', () => {
    it('auto with key resolves to online', () => {
      expect(resolveMode('auto', true)).toBe('online');
    });

    it('auto without key resolves to offline', () => {
      expect(resolveMode('auto', false)).toBe('offline');
    });

    it('explicit modes pass through unchanged', () => {
      expect(resolveMode('offline', true)).toBe('offline');
      expect(resolveMode('online', false)).toBe('online');
      expect(resolveMode('nightly', true)).toBe('nightly');
    });
  });

  describe('skipStep', () => {
    it('creates a skipped step with reason', () => {
      const step = skipStep('test-step', 'echo hi', 'no API key');
      expect(step.status).toBe('skip');
      expect(step.exit_code).toBeNull();
      expect(step.skip_reason).toBe('no API key');
      expect(step.duration_ms).toBe(0);
    });
  });

  describe('runStep', () => {
    it('runs a passing command', () => {
      const step = runStep('echo-test', 'echo hello');
      expect(step.status).toBe('pass');
      expect(step.exit_code).toBe(0);
      expect(step.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('runs a failing command', () => {
      const step = runStep('fail-test', 'exit 1');
      expect(step.status).toBe('fail');
      expect(step.exit_code).toBe(1);
    });
  });

  describe('summarizeSteps', () => {
    it('counts pass/fail/skip correctly', () => {
      const steps: GateStep[] = [
        { name: 'a', command: '', status: 'pass', exit_code: 0, duration_ms: 10 },
        { name: 'b', command: '', status: 'fail', exit_code: 1, duration_ms: 20 },
        { name: 'c', command: '', status: 'skip', exit_code: null, duration_ms: 0 },
        { name: 'd', command: '', status: 'pass', exit_code: 0, duration_ms: 5 },
      ];
      const s = summarizeSteps(steps);
      expect(s.total).toBe(4);
      expect(s.passed).toBe(2);
      expect(s.failed).toBe(1);
      expect(s.skipped).toBe(1);
    });

    it('handles empty steps', () => {
      const s = summarizeSteps([]);
      expect(s.total).toBe(0);
      expect(s.passed).toBe(0);
    });
  });

  describe('buildGateReport', () => {
    it('produces a valid report with pass verdict', () => {
      const offlineSteps: GateStep[] = [
        { name: 'foundation-check', command: 'echo ok', status: 'pass', exit_code: 0, duration_ms: 100 },
        { name: 'eval-local', command: 'echo ok', status: 'pass', exit_code: 0, duration_ms: 200 },
      ];
      const report = buildGateReport('offline', 'offline', offlineSteps, [], {}, ['report.json'], []);
      expect(report.schema_version).toBe('1.0');
      expect(report.verdict).toBe('pass');
      expect(report.offline_summary.passed).toBe(2);
      expect(report.online_summary).toBeNull();
    });

    it('sets fail verdict when any step fails', () => {
      const steps: GateStep[] = [
        { name: 'a', command: '', status: 'pass', exit_code: 0, duration_ms: 0 },
        { name: 'b', command: '', status: 'fail', exit_code: 1, duration_ms: 0 },
      ];
      const report = buildGateReport('offline', 'offline', steps, [], {}, [], []);
      expect(report.verdict).toBe('fail');
    });

    it('includes online summary when online steps present', () => {
      const offline: GateStep[] = [
        { name: 'a', command: '', status: 'pass', exit_code: 0, duration_ms: 0 },
      ];
      const online: GateStep[] = [
        { name: 'eval-online', command: '', status: 'pass', exit_code: 0, duration_ms: 5000 },
      ];
      const report = buildGateReport('online', 'online', offline, online, {}, [], []);
      expect(report.online_summary).not.toBeNull();
      expect(report.online_summary!.passed).toBe(1);
    });

    it('includes skipped reasons', () => {
      const report = buildGateReport('auto', 'offline', [], [], {}, [], ['no API key']);
      expect(report.skipped_reasons).toContain('no API key');
      expect(report.mode).toBe('auto');
      expect(report.effective_mode).toBe('offline');
    });
  });

  describe('schema conformance', () => {
    const schema = JSON.parse(readFileSync(GATE_SCHEMA_PATH, 'utf-8'));

    it('offline report conforms to quality-gate-result.schema.json', () => {
      const offlineSteps: GateStep[] = [
        { name: 'foundation-check', command: 'echo ok', status: 'pass', exit_code: 0, duration_ms: 100 },
        { name: 'eval-local', command: 'echo ok', status: 'pass', exit_code: 0, duration_ms: 200 },
        { name: 'benchmark-compare', command: '', status: 'skip', exit_code: null, duration_ms: 0, skip_reason: 'no baseline' },
      ];
      const report = buildGateReport(
        'offline', 'offline', offlineSteps, [], { benchmark_compare_verdict: 'skip' },
        ['foundation.json', 'eval.json'], ['no baseline'],
      );
      const serialized = JSON.parse(JSON.stringify(report));
      const errors = validateJsonSchema(serialized, schema, schema);
      expect(errors).toEqual([]);
    });

    it('auto-mode report with skipped online conforms', () => {
      const offline: GateStep[] = [
        { name: 'foundation-check', command: 'echo ok', status: 'pass', exit_code: 0, duration_ms: 50 },
      ];
      const online: GateStep[] = [
        { name: 'eval-online', command: '', status: 'skip', exit_code: null, duration_ms: 0, skip_reason: 'no key' },
      ];
      const report = buildGateReport(
        'auto', 'offline', offline, online,
        { online_compare_verdict: 'skip' },
        [], ['ANTHROPIC_API_KEY not set'],
      );
      const serialized = JSON.parse(JSON.stringify(report));
      const errors = validateJsonSchema(serialized, schema, schema);
      expect(errors).toEqual([]);
    });

    it('online-mode report with regression info conforms', () => {
      const offline: GateStep[] = [
        { name: 'foundation-check', command: 'cmd', status: 'pass', exit_code: 0, duration_ms: 100 },
      ];
      const online: GateStep[] = [
        { name: 'eval-online', command: 'cmd', status: 'pass', exit_code: 0, duration_ms: 5000 },
        { name: 'eval-online-compare', command: 'cmd', status: 'pass', exit_code: 0, duration_ms: 50 },
      ];
      const report = buildGateReport(
        'online', 'online', offline, online,
        { online_compare_verdict: 'pass', benchmark_compare_verdict: 'pass' },
        ['foundation.json', 'online.json', 'compare.json'], [],
        'abc1234',
      );
      const serialized = JSON.parse(JSON.stringify(report));
      const errors = validateJsonSchema(serialized, schema, schema);
      expect(errors).toEqual([]);
    });
  });
});
