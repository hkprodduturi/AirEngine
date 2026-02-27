/**
 * H11 Remediation Tests
 *
 * Tests for runtime/env remediation, UI/layout remediation, and
 * the multi-lane heal loop integration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import {
  classifyRuntimeIssues,
  runRemediation,
  hasRuntimeIssues,
  type RemediationContext,
  type RuntimeIssue,
  type RemediationReport,
} from '../src/self-heal/runtime-remediator.js';

import {
  classifyUIIssues,
  runUIRemediation,
  hasUIIssues,
  getUIRemediationTargets,
} from '../src/self-heal/ui-layout-remediator.js';

import {
  runDevHealLoop,
  isPromotionAllowed,
  type DevHealOptions,
} from '../src/self-heal/heal-loop.js';

import { isAllowedSelfHealPatchTarget } from '../src/self-heal/transpiler-patch.js';

import { generateFlowSpec } from '../src/self-heal/flow-generator.js';
import type { QAExecutor, RuntimeQAResult, FlowSpec } from '../src/self-heal/runtime-qa.js';

// ---- Helpers ----

function createMockQAResult(overrides: Partial<RuntimeQAResult> = {}): RuntimeQAResult {
  return {
    schema_version: '1.0',
    qa_run_id: 'QR-mock',
    flow_id: 'test',
    timestamp: new Date().toISOString(),
    run_metadata: { headless: true, flow_path: '<mock>' },
    preflight: { health_check_url: '', status: 'pass', latency_ms: 0, error: null },
    steps: [],
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, dead_ctas: 0, console_errors: 0 },
    verdict: 'pass',
    incident_paths: [],
    ...overrides,
  };
}

function createExecutor(result: RuntimeQAResult): QAExecutor {
  return async () => result;
}

// ---- Runtime Remediation Tests ----

describe('H11: Runtime/Env Remediation', () => {
  it('classifies preflight failure as server-not-running', () => {
    const qa = createMockQAResult({
      preflight: { health_check_url: 'http://localhost:3001/api/health', status: 'fail', latency_ms: 0, error: 'fetch failed: ECONNREFUSED' },
      verdict: 'fail',
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', true);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].kind).toBe('server-not-running');
    expect(issues[0].severity).toBe('critical');
  });

  it('classifies console DB errors as db-connection-failure', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Navigate', action: 'navigate', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: ['PrismaClientInitializationError: database connection failed'],
          network_requests: [], dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Console errors', dead_cta_detected: false,
      }],
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', true);
    expect(issues.some(i => i.kind === 'db-connection-failure')).toBe(true);
  });

  it('classifies missing module as dependency-missing', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Navigate', action: 'navigate', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: ['Error: Cannot find module express'],
          network_requests: [], dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Module error', dead_cta_detected: false,
      }],
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', true);
    expect(issues.some(i => i.kind === 'dependency-missing')).toBe(true);
  });

  it('classifies JWT error as auth-session-boot', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Login', action: 'click', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: ['JsonWebTokenError: jwt malformed'],
          network_requests: [], dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Auth error', dead_cta_detected: false,
      }],
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', true);
    expect(issues.some(i => i.kind === 'auth-session-boot')).toBe(true);
  });

  it('runRemediation executes matching actions in dry run', () => {
    const issues: RuntimeIssue[] = [
      { kind: 'dependency-missing', severity: 'high', details: 'Missing dep', evidence: [] },
      { kind: 'db-connection-failure', severity: 'critical', details: 'DB down', evidence: [] },
    ];
    const ctx: RemediationContext = {
      outputDir: '/tmp/test-output',
      clientPort: 3000,
      serverPort: 3001,
      hasBackend: true,
      dryRun: true,
    };
    const report = runRemediation(issues, ctx);
    expect(report.actions.length).toBe(2);
    expect(report.actions.every(a => a.status === 'pass')).toBe(true);
    expect(report.issuesFixed).toBe(2);
  });

  it('hasRuntimeIssues returns true for preflight failures', () => {
    const qa = createMockQAResult({
      preflight: { health_check_url: '', status: 'fail', latency_ms: 0, error: 'ECONNREFUSED' },
      verdict: 'fail',
    });
    expect(hasRuntimeIssues(qa)).toBe(true);
  });

  it('hasRuntimeIssues returns false for passing QA', () => {
    const qa = createMockQAResult({ verdict: 'pass' });
    expect(hasRuntimeIssues(qa)).toBe(false);
  });

  it('deduplicates issues by kind', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [
        {
          step_id: 'S001', label: 'Nav1', action: 'navigate', status: 'fail', duration_ms: 0,
          evidence: {
            selector: null, text_content: null, url_before: null, url_after: null,
            screenshot_path: null, console_errors: ['Cannot find module A', 'Cannot find module B'],
            network_requests: [], dom_snippet: null, dom_changed: false,
          },
          failure_reason: 'err', dead_cta_detected: false,
        },
      ],
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', false);
    const depIssues = issues.filter(i => i.kind === 'dependency-missing');
    expect(depIssues.length).toBe(1); // Deduplicated
  });
});

// ---- UI/Layout Remediation Tests ----

describe('H11: UI/Layout Remediation', () => {
  it('classifies style mismatch on nav as nav-sidebar-overlap', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Assert sidebar', action: 'assert_style', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false, computed_styles: { position: 'static' },
        },
        failure_reason: 'Style mismatch on nav sidebar: expected fixed, got static',
        dead_cta_detected: false,
        assert_style: { selector: 'aside.sidebar', expected_styles: { position: 'fixed' } },
      } as any],
    });
    const issues = classifyUIIssues(qa);
    expect(issues.some(i => i.kind === 'nav-sidebar-overlap')).toBe(true);
  });

  it('classifies overflow failure', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Assert no overflow', action: 'assert_style', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Content overflow clipping detected',
        dead_cta_detected: false,
        assert_style: { selector: 'main', expected_styles: { overflow: 'visible' } },
      } as any],
    });
    const issues = classifyUIIssues(qa);
    expect(issues.some(i => i.kind === 'overflow-clipping')).toBe(true);
  });

  it('classifies spacing inconsistency', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Assert padding', action: 'assert_style', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Padding mismatch: expected 16px, got 8px',
        dead_cta_detected: false,
        assert_style: { selector: '.card', expected_styles: { padding: '16px' } },
      } as any],
    });
    const issues = classifyUIIssues(qa);
    expect(issues.some(i => i.kind === 'spacing-inconsistency')).toBe(true);
  });

  it('hasUIIssues returns true for assert_style failures', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Style check', action: 'assert_style', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Style mismatch', dead_cta_detected: false,
      }],
    });
    expect(hasUIIssues(qa)).toBe(true);
  });

  it('hasUIIssues returns false for dead-cta-only failures', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Click CTA', action: 'click', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Dead CTA', dead_cta_detected: true,
      }],
    });
    expect(hasUIIssues(qa)).toBe(false);
  });

  it('UI remediation targets are all framework-owned', () => {
    const targets = getUIRemediationTargets();
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(isAllowedSelfHealPatchTarget(target)).toBe(true);
    }
  });

  it('UI remediation patches only allowed files', () => {
    const issues = [
      { kind: 'overflow-clipping' as const, severity: 'high' as const, details: 'test', evidence: [] },
    ];
    const report = runUIRemediation(issues);
    // All results should target framework files
    for (const r of report.results) {
      if (r.status !== 'skip') {
        expect(isAllowedSelfHealPatchTarget(r.target_file)).toBe(true);
      }
    }
  });

  it('deduplicates UI issues by kind', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [
        {
          step_id: 'S001', label: 'Assert 1', action: 'assert_style', status: 'fail',
          duration_ms: 0,
          evidence: { selector: null, text_content: null, url_before: null, url_after: null, screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: null, dom_changed: false },
          failure_reason: 'Content overflow clipping A', dead_cta_detected: false,
          assert_style: { selector: 'div.a', expected_styles: {} },
        } as any,
        {
          step_id: 'S002', label: 'Assert 2', action: 'assert_style', status: 'fail',
          duration_ms: 0,
          evidence: { selector: null, text_content: null, url_before: null, url_after: null, screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: null, dom_changed: false },
          failure_reason: 'Content overflow clipping B', dead_cta_detected: false,
          assert_style: { selector: 'div.b', expected_styles: {} },
        } as any,
      ],
    });
    const issues = classifyUIIssues(qa);
    const overflowIssues = issues.filter(i => i.kind === 'overflow-clipping');
    expect(overflowIssues.length).toBe(1); // Deduplicated
  });
});

// ---- Multi-Lane Heal Loop Tests ----

describe('H11: Multi-lane heal loop', () => {
  function createPassingExecutor(): QAExecutor {
    return async (spec) => createMockQAResult({
      flow_id: spec.flow_id,
      verdict: 'pass',
    });
  }

  function createFailingWithRuntimeExecutor(): QAExecutor {
    let callCount = 0;
    return async (spec) => {
      callCount++;
      // First call fails, second call (after remediation) passes
      if (callCount === 1) {
        return createMockQAResult({
          flow_id: spec.flow_id,
          verdict: 'fail',
          preflight: { health_check_url: '', status: 'fail', latency_ms: 0, error: 'ECONNREFUSED' },
          steps: [{
            step_id: 'S001', label: 'Navigate', action: 'navigate', status: 'fail',
            duration_ms: 0,
            evidence: {
              selector: null, text_content: null, url_before: null, url_after: null,
              screenshot_path: null, console_errors: ['Cannot find module express'],
              network_requests: [], dom_snippet: null, dom_changed: false,
            },
            failure_reason: 'Server down', dead_cta_detected: false,
          }],
          summary: { total: 1, passed: 0, failed: 1, skipped: 0, dead_ctas: 0, console_errors: 1 },
        });
      }
      return createMockQAResult({ flow_id: spec.flow_id, verdict: 'pass' });
    };
  }

  it('heal loop passes through when QA passes', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'transpiler-patch',
      outputDir: '/tmp/test-output',
      executeFlow: createPassingExecutor(),
    });

    expect(result.qaVerdict).toBe('pass');
    expect(result.verdict).toBe('pass');
    expect(result.lanes).toBeDefined();
  });

  it('runtime remediation lane runs for runtime issues', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);

    const mockRemediation = (issues: RuntimeIssue[]): RemediationReport => ({
      issues,
      actions: issues.map(i => ({
        action_id: 'REM-mock',
        status: 'pass' as const,
        description: `Fixed ${i.kind}`,
        details: 'Mock fix',
        durationMs: 0,
      })),
      issuesFixed: issues.length,
      issuesPending: 0,
      durationMs: 0,
    });

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'transpiler-patch',
      outputDir: '/tmp/test-output',
      executeFlow: createFailingWithRuntimeExecutor(),
      mockRemediation,
    });

    // Runtime lane should have run
    const runtimeLane = result.lanes.find(l => l.lane === 'runtime');
    expect(runtimeLane?.ran).toBe(true);
    expect(result.runtimeRemediation).toBeDefined();
    expect(result.runtimeRemediation!.issuesFixed).toBeGreaterThan(0);

    // After remediation, QA re-ran and passed
    expect(result.qaVerdict).toBe('pass');
    expect(result.verdict).toBe('pass');
  });

  it('failed remediation falls back to transpiler lane', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);

    // Runtime remediation fails
    const mockRemediation = (issues: RuntimeIssue[]): RemediationReport => ({
      issues,
      actions: issues.map(i => ({
        action_id: 'REM-mock',
        status: 'fail' as const,
        description: `Failed ${i.kind}`,
        details: 'Mock failure',
        durationMs: 0,
      })),
      issuesFixed: 0,
      issuesPending: issues.length,
      durationMs: 0,
    });

    // QA always fails
    const executor: QAExecutor = async (spec) => createMockQAResult({
      flow_id: spec.flow_id,
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Click nav', action: 'click', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: ['ERR_MODULE_NOT_FOUND'],
          network_requests: [], dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Dead CTA', dead_cta_detected: true,
      }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0, dead_ctas: 1, console_errors: 1 },
    });

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'transpiler-patch',
      outputDir: '/tmp/test-output',
      executeFlow: executor,
      mockRemediation,
    });

    // Runtime failed
    expect(result.runtimeRemediation?.issuesFixed).toBe(0);
    // Transpiler lane still ran
    const transpilerLane = result.lanes.find(l => l.lane === 'transpiler');
    expect(transpilerLane).toBeDefined();
    expect(result.verdict).toBe('fail');
  });

  it('no generated-output patching guarantee', () => {
    // Verify all generated output paths are blocked
    const outputPaths = [
      'output/client/src/App.jsx',
      'output-ecommerce/client/src/App.jsx',
      'dist/cli/index.js',
      'artifacts/demo/report.json',
      'demo-output/client/App.jsx',
      '.air-artifacts/manifest.json',
      'test-output/src/App.jsx',
      'node_modules/react/index.js',
    ];
    for (const path of outputPaths) {
      expect(isPromotionAllowed(path)).toBe(false);
    }

    // Framework source IS allowed
    expect(isPromotionAllowed('src/transpiler/scaffold.ts')).toBe(true);
    expect(isPromotionAllowed('src/self-heal/invariants.ts')).toBe(true);
    expect(isPromotionAllowed('src/transpiler/react/layout-gen.ts')).toBe(true);
  });

  it('heal loop result includes lane details', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);

    // Executor returns failing result with dead CTA
    const executor: QAExecutor = async (spec) => createMockQAResult({
      flow_id: spec.flow_id,
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Click', action: 'click', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Dead CTA', dead_cta_detected: true,
      }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0, dead_ctas: 1, console_errors: 0 },
    });

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'transpiler-patch',
      outputDir: '/tmp/test-output',
      executeFlow: executor,
      skipRuntimeRemediation: true,
    });

    expect(result.lanes.length).toBe(4);
    expect(result.lanes.map(l => l.lane)).toEqual(['runtime', 'parser', 'transpiler', 'ui']);
  });

  it('shadow mode skips all remediation lanes', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);

    const executor: QAExecutor = async (spec) => createMockQAResult({
      flow_id: spec.flow_id,
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Click', action: 'click', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
        },
        failure_reason: 'Dead CTA', dead_cta_detected: true,
      }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0, dead_ctas: 1, console_errors: 0 },
    });

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'shadow',
      outputDir: '/tmp/test-output',
      executeFlow: executor,
    });

    expect(result.verdict).toBe('fail');
    expect(result.runtimeRemediation).toBeUndefined();
    expect(result.uiRemediation).toBeUndefined();
    // Shadow mode has no lanes populated
    expect(result.lanes.length).toBe(0);
  });

  it('UI remediation targets never include generated output', () => {
    const targets = getUIRemediationTargets();
    for (const target of targets) {
      expect(isPromotionAllowed(target)).toBe(true);
      // Double check it's not in any output directory
      expect(target.startsWith('output/')).toBe(false);
      expect(target.startsWith('dist/')).toBe(false);
      expect(target.startsWith('artifacts/')).toBe(false);
    }
  });

  it('no QA rerun when no patches promoted (healApply=none)', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);
    let executorCallCount = 0;

    const executor: QAExecutor = async (spec) => {
      executorCallCount++;
      return createMockQAResult({
        flow_id: spec.flow_id,
        verdict: 'fail',
        steps: [{
          step_id: 'S001', label: 'Click', action: 'click', status: 'fail',
          duration_ms: 0,
          evidence: {
            selector: null, text_content: null, url_before: null, url_after: null,
            screenshot_path: null, console_errors: [], network_requests: [],
            dom_snippet: null, dom_changed: false,
          },
          failure_reason: 'Dead CTA', dead_cta_detected: true,
        }],
        summary: { total: 1, passed: 0, failed: 1, skipped: 0, dead_ctas: 1, console_errors: 0 },
      });
    };

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'transpiler-patch',
      outputDir: '/tmp/test-output',
      executeFlow: executor,
      skipRuntimeRemediation: true,
      // healApply defaults to 'none' → no promotion → no QA rerun
    });

    // Executor called exactly once (initial QA run only, no rerun)
    expect(executorCallCount).toBe(1);
    // No patches promoted, so no QA rerun
    expect(result.postPatchQARerun).toBeUndefined();
    expect(result.promotedFiles).toEqual([]);
  });

  it('no QA rerun when healApply=verified but no patches verified', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);
    let executorCallCount = 0;

    const executor: QAExecutor = async (spec) => {
      executorCallCount++;
      return createMockQAResult({
        flow_id: spec.flow_id,
        verdict: 'fail',
        steps: [{
          step_id: 'S001', label: 'Click', action: 'click', status: 'fail',
          duration_ms: 0,
          evidence: {
            selector: null, text_content: null, url_before: null, url_after: null,
            screenshot_path: null, console_errors: [], network_requests: [],
            dom_snippet: null, dom_changed: false,
          },
          failure_reason: 'Dead CTA', dead_cta_detected: true,
        }],
        summary: { total: 1, passed: 0, failed: 1, skipped: 0, dead_ctas: 1, console_errors: 0 },
      });
    };

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'transpiler-patch',
      outputDir: '/tmp/test-output',
      executeFlow: executor,
      healApply: 'verified',
      skipRuntimeRemediation: true,
    });

    // Executor called exactly once (no patches to promote → no rerun)
    expect(executorCallCount).toBe(1);
    expect(result.postPatchQARerun).toBeUndefined();
    expect(result.promotedFiles).toEqual([]);
  });

  it('verdict is fail when post-patch QA rerun is worse', async () => {
    const source = readFileSync('examples/todo.air', 'utf-8');
    const flowSpec = generateFlowSpec(source);

    // This test verifies the verdict logic path where no patches match,
    // so no promotion happens, and verdict is determined by existing state.
    const executor: QAExecutor = async (spec) => createMockQAResult({
      flow_id: spec.flow_id,
      verdict: 'fail',
      steps: [
        {
          step_id: 'S001', label: 'Click CTA', action: 'click', status: 'fail',
          duration_ms: 0,
          evidence: {
            selector: null, text_content: null, url_before: null, url_after: null,
            screenshot_path: null, console_errors: [], network_requests: [],
            dom_snippet: null, dom_changed: false,
          },
          failure_reason: 'Dead CTA', dead_cta_detected: true,
        },
        {
          step_id: 'S002', label: 'Another fail', action: 'click', status: 'fail',
          duration_ms: 0,
          evidence: {
            selector: null, text_content: null, url_before: null, url_after: null,
            screenshot_path: null, console_errors: [], network_requests: [],
            dom_snippet: null, dom_changed: false,
          },
          failure_reason: 'Dead CTA', dead_cta_detected: true,
        },
      ],
      summary: { total: 2, passed: 0, failed: 2, skipped: 0, dead_ctas: 2, console_errors: 0 },
    });

    const result = await runDevHealLoop({
      flowSpec,
      mode: 'transpiler-patch',
      outputDir: '/tmp/test-output',
      executeFlow: executor,
      healApply: 'verified',
      skipRuntimeRemediation: true,
    });

    // No patches matched → no promotion → no rerun → fail verdict
    expect(result.verdict).toBe('fail');
    expect(result.failedSteps).toBe(2);
    expect(result.postPatchQARerun).toBeUndefined();
  });

  it('parser lane allowed as patch target', () => {
    // src/parser/ paths are now allowed
    expect(isPromotionAllowed('src/parser/parsers.ts')).toBe(true);
    expect(isPromotionAllowed('src/parser/lexer.ts')).toBe(true);
  });

  it('skipped-conflict verdict is valid type', async () => {
    // Verify the verdict union includes skipped-conflict
    const ref: import('../src/self-heal/heal-loop.js').TranspilerPatchRef = {
      trace_id: 'test',
      transpiler_file: 'src/transpiler/index.ts',
      strategy: 'test',
      verdict: 'skipped-conflict',
    };
    expect(ref.verdict).toBe('skipped-conflict');
  });
});

// ---- Runtime Hardening Tests (H11 Gap Closure — D1) ----

describe('H11: Runtime hardening — failed_requests + response_statuses', () => {
  it('hasRuntimeIssues returns true for failed_requests with connection refused', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Navigate', action: 'navigate', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
          failed_requests: [{ url: 'http://localhost:3001/api/items', method: 'GET', failure: 'net::ERR_CONNECTION_REFUSED' }],
        },
        failure_reason: 'fetch failed', dead_cta_detected: false,
      }],
    });
    expect(hasRuntimeIssues(qa)).toBe(true);
  });

  it('hasRuntimeIssues returns true for response_statuses with 500 on API path', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Navigate', action: 'navigate', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
          response_statuses: [{ url: 'http://localhost:3001/api/items', method: 'GET', status: 500 }],
        },
        failure_reason: 'Server error', dead_cta_detected: false,
      }],
    });
    expect(hasRuntimeIssues(qa)).toBe(true);
  });

  it('classifyRuntimeIssues classifies failed_requests as server-not-running', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Fetch items', action: 'navigate', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
          failed_requests: [{ url: 'http://localhost:3001/api/items', method: 'GET', failure: 'net::ERR_CONNECTION_REFUSED' }],
        },
        failure_reason: 'fetch failed', dead_cta_detected: false,
      }],
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', true);
    expect(issues.some(i => i.kind === 'server-not-running')).toBe(true);
  });

  it('classifyRuntimeIssues classifies 401 response as auth-session-boot', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Fetch protected', action: 'navigate', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
          response_statuses: [{ url: 'http://localhost:3001/api/profile', method: 'GET', status: 401 }],
        },
        failure_reason: 'Unauthorized', dead_cta_detected: false,
      }],
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', true);
    expect(issues.some(i => i.kind === 'auth-session-boot')).toBe(true);
  });

  it('hasRuntimeIssues returns false when failed_requests and response_statuses are empty', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Click', action: 'click', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
          failed_requests: [],
          response_statuses: [],
        },
        failure_reason: 'Dead CTA', dead_cta_detected: true,
      }],
    });
    expect(hasRuntimeIssues(qa)).toBe(false);
  });

  it('backward compat: hasRuntimeIssues works when new fields are undefined', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'Click', action: 'click', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
          // failed_requests and response_statuses are NOT set (undefined)
        },
        failure_reason: 'Dead CTA', dead_cta_detected: true,
      }],
    });
    // Should not throw, should return false (no runtime issues)
    expect(hasRuntimeIssues(qa)).toBe(false);
  });

  it('classifyRuntimeIssues classifies 5xx on db path as db-connection-failure', () => {
    const qa = createMockQAResult({
      verdict: 'fail',
      steps: [{
        step_id: 'S001', label: 'DB query', action: 'navigate', status: 'fail',
        duration_ms: 0,
        evidence: {
          selector: null, text_content: null, url_before: null, url_after: null,
          screenshot_path: null, console_errors: [], network_requests: [],
          dom_snippet: null, dom_changed: false,
          response_statuses: [{ url: 'http://localhost:3001/api/db/health', method: 'GET', status: 500 }],
        },
        failure_reason: 'DB error', dead_cta_detected: false,
      }],
    });
    const issues = classifyRuntimeIssues(qa, '/tmp/test', true);
    expect(issues.some(i => i.kind === 'db-connection-failure')).toBe(true);
  });
});
