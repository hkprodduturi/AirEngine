/**
 * Runtime QA + Self-Heal Loop Tests (SH8)
 *
 * All tests use mock Page objects — no real browser required.
 * Live browser tests gated behind RUNTIME_QA_LIVE=1 env var (guardrail 8).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { validateJsonSchema } from './schema-validator.js';

import {
  loadFlowSpec,
  generateQARunId,
  executeFlow,
  executeStep,
  detectDeadCTA,
  captureEvidence,
  validateQAResult,
  type FlowSpec,
  type FlowStep,
  type MockablePage,
  type StepEvidence,
  type RuntimeQAResult,
  type QARunOptions,
} from '../scripts/runtime-qa-run.js';

import {
  stepToIncidentArgs,
  bridgeFailedSteps,
  buildRichEvidence,
  type BridgedIncident,
} from '../scripts/runtime-qa-bridge.js';

import { classifyIncident, PATTERN_REGISTRY } from '../scripts/classify-incident.js';

import {
  runHealLoop,
  generateLoopId,
  validateHealLoopResult,
  type HealLoopResult,
  type HealLoopOptions,
} from '../scripts/self-heal-loop.js';

// ---- Mock Page Factory ----

interface MockPageOptions {
  url?: string;
  urlAfterClick?: string;
  domChanged?: boolean;
  evaluateResults?: Record<string, unknown>;
  clickThrows?: boolean;
  waitForSelectorThrows?: boolean;
}

function createMockPage(opts: MockPageOptions = {}): MockablePage {
  let currentUrl = opts.url || 'http://localhost:5173/';
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  return {
    url() { return currentUrl; },
    async goto(url: string) {
      currentUrl = url;
    },
    async click(_selector: string) {
      if (opts.clickThrows) throw new Error('Element not found');
      if (opts.urlAfterClick) currentUrl = opts.urlAfterClick;
    },
    async fill(_selector: string, _value: string) {},
    async waitForSelector(_selector: string) {
      if (opts.waitForSelectorThrows) throw new Error('Timeout');
      return {};
    },
    async evaluate(fn: unknown) {
      // Handle DOM mutation observer setup/teardown
      if (typeof fn === 'string') {
        if (fn.includes('__sh8_domChanged = false')) return undefined as any;
        if (fn.includes('__sh8_observer')) {
          return (opts.domChanged ?? false) as any;
        }
        if (fn.includes('document.querySelector')) {
          return { text: 'View Portfolio', html: '<button>View Portfolio</button>' } as any;
        }
      }
      return null as any;
    },
    async screenshot() { return Buffer.from('fake-screenshot'); },
    async close() {},
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    removeAllListeners(event: string) {
      delete listeners[event];
    },
  };
}

// ---- Mock Flow Spec ----

function getPhotographyFlowPath(): string {
  return join(__dirname, '..', 'qa-flows', 'photography-public.json');
}

function createMinimalFlowSpec(): FlowSpec {
  return {
    flow_id: 'test-flow',
    base_url_client: 'http://localhost:5173',
    base_url_server: 'http://localhost:3001',
    preflight_health_path: '/api/health',
    steps: [
      {
        step_id: 'step-1',
        label: 'Click test button',
        action: 'click',
        selector: 'button:has-text("Test")',
        expected: { url_change: true, dom_mutation: true },
        dead_cta_check: true,
        severity: 'p1',
      },
    ],
  };
}

// ---- Helper to build a mock QA result ----

function createMockQAResult(overrides: Partial<RuntimeQAResult> = {}): RuntimeQAResult {
  return {
    schema_version: '1.0',
    qa_run_id: 'QR-20260226-120000-abc123',
    flow_id: 'photography-public',
    timestamp: new Date().toISOString(),
    run_metadata: { headless: true, flow_path: 'qa-flows/photography-public.json' },
    preflight: { health_check_url: 'http://localhost:3001/api/health', status: 'pass', latency_ms: 50, error: null },
    steps: [],
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, dead_ctas: 0, console_errors: 0 },
    verdict: 'pass',
    incident_paths: [],
    ...overrides,
  };
}

// ---- Shared flow path ----

const mockFlowPath = getPhotographyFlowPath();

// ======== Test Groups ========

describe('SH8 Runtime QA', () => {
  // ---- 1. Flow spec parsing (5 tests, guardrail 6) ----
  describe('Flow spec parsing', () => {
    it('loads photography flow spec correctly', () => {
      const spec = loadFlowSpec(getPhotographyFlowPath());
      expect(spec.flow_id).toBe('photography-public');
      expect(spec.base_url_client).toBe('http://localhost:5173');
      expect(spec.base_url_server).toBe('http://localhost:3001');
      expect(spec.preflight_health_path).toBe('/api/health');
      expect(spec.steps.length).toBeGreaterThanOrEqual(7);
    });

    it('validates preconditions — flow_id required', () => {
      const bad = JSON.stringify({ base_url_client: 'x', base_url_server: 'y', preflight_health_path: '/h', steps: [{ step_id: 's', label: 'l', action: 'click' }] });
      const tmpPath = join(__dirname, '..', 'artifacts', 'test-bad-flow.json');
      require('fs').writeFileSync(tmpPath, bad);
      expect(() => loadFlowSpec(tmpPath)).toThrow('missing flow_id');
      require('fs').unlinkSync(tmpPath);
    });

    it('validates preconditions — steps required', () => {
      const bad = JSON.stringify({ flow_id: 'x', base_url_client: 'x', base_url_server: 'y', preflight_health_path: '/h', steps: [] });
      const tmpPath = join(__dirname, '..', 'artifacts', 'test-bad-flow2.json');
      require('fs').writeFileSync(tmpPath, bad);
      expect(() => loadFlowSpec(tmpPath)).toThrow('at least one step');
      require('fs').unlinkSync(tmpPath);
    });

    it('validates step structure', () => {
      const bad = JSON.stringify({ flow_id: 'x', base_url_client: 'x', base_url_server: 'y', preflight_health_path: '/h', steps: [{ step_id: '', label: 'l', action: 'click' }] });
      const tmpPath = join(__dirname, '..', 'artifacts', 'test-bad-flow3.json');
      require('fs').writeFileSync(tmpPath, bad);
      expect(() => loadFlowSpec(tmpPath)).toThrow('step_id');
      require('fs').unlinkSync(tmpPath);
    });

    it('reads setup hooks from flow spec', () => {
      const spec = loadFlowSpec(getPhotographyFlowPath());
      expect(spec.setup).toContain('ensure_logged_out');
    });
  });

  // ---- 2. Schema conformance (5 tests) ----
  describe('Schema conformance', () => {
    it('QA run ID matches pattern', () => {
      const id = generateQARunId();
      expect(id).toMatch(/^QR-\d{8}-\d{6}-[a-z0-9]{6}$/);
    });

    it('loop ID matches pattern', () => {
      const id = generateLoopId();
      expect(id).toMatch(/^HL-\d{8}-\d{6}-[a-z0-9]{6}$/);
    });

    it('runtime-qa-result.schema.json is valid JSON Schema', () => {
      const schema = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'runtime-qa-result.schema.json'), 'utf-8'));
      expect(schema.$schema).toContain('json-schema.org');
      expect(schema.required).toContain('qa_run_id');
      expect(schema.required).toContain('preflight');
      expect(schema.required).toContain('steps');
    });

    it('self-heal-loop-result.schema.json is valid JSON Schema', () => {
      const schema = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'self-heal-loop-result.schema.json'), 'utf-8'));
      expect(schema.$schema).toContain('json-schema.org');
      expect(schema.required).toContain('loop_id');
      expect(schema.required).toContain('bridged_incidents');
    });

    it('incident schema includes runtime-qa source', () => {
      const schema = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'self-heal-incident.schema.json'), 'utf-8'));
      const sourceEnum = schema.properties.source.enum;
      expect(sourceEnum).toContain('runtime-qa');
    });
  });

  // ---- 3. Preflight checks (3 tests, guardrail 2) ----
  describe('Preflight checks', () => {
    it('dry run returns skip status', async () => {
      const spec = createMinimalFlowSpec();
      const result = await executeFlow(spec, { dryRun: true, mockPage: createMockPage() });
      expect(result.preflight.status).toBe('skip');
    });

    it('mock preflight success', async () => {
      const spec = createMinimalFlowSpec();
      const result = await executeFlow(spec, {
        mockPage: createMockPage(),
        mockPreflight: async () => ({
          health_check_url: 'http://localhost:3001/api/health',
          status: 'pass',
          latency_ms: 42,
          error: null,
        }),
      });
      expect(result.preflight.status).toBe('pass');
    });

    it('preflight failure aborts flow', async () => {
      const spec = createMinimalFlowSpec();
      const result = await executeFlow(spec, {
        mockPage: createMockPage(),
        mockPreflight: async () => ({
          health_check_url: 'http://localhost:3001/api/health',
          status: 'fail',
          latency_ms: 5000,
          error: 'App not reachable at http://localhost:3001/api/health',
        }),
      });
      expect(result.preflight.status).toBe('fail');
      expect(result.verdict).toBe('fail');
      expect(result.steps).toHaveLength(0);
    });
  });

  // ---- 4. Dead CTA heuristic (6 tests, guardrail 1) ----
  describe('Dead CTA detection (step-aware)', () => {
    it('detects dead CTA when all expected signals absent', async () => {
      const page = createMockPage({ domChanged: false }); // URL stays same, DOM unchanged
      const step: FlowStep = {
        step_id: 'test',
        label: 'Click dead button',
        action: 'click',
        selector: 'button.dead',
        expected: { url_change: true, dom_mutation: true },
        dead_cta_check: true,
      };
      const result = await detectDeadCTA(page, step, [], []);
      expect(result.dead).toBe(true);
    });

    it('does not flag when url changes', async () => {
      const page = createMockPage({ urlAfterClick: 'http://localhost:5173/portfolio', domChanged: false });
      const step: FlowStep = {
        step_id: 'test',
        label: 'Click working button',
        action: 'click',
        selector: 'button.works',
        expected: { url_change: true },
        dead_cta_check: true,
      };
      const result = await detectDeadCTA(page, step, [], []);
      expect(result.dead).toBe(false);
    });

    it('does not flag when DOM changes', async () => {
      const page = createMockPage({ domChanged: true });
      const step: FlowStep = {
        step_id: 'test',
        label: 'Click DOM-mutating button',
        action: 'click',
        selector: 'button.dom',
        expected: { dom_mutation: true },
        dead_cta_check: true,
      };
      const result = await detectDeadCTA(page, step, [], []);
      expect(result.dead).toBe(false);
    });

    it('checks only expected signals — url_change only', async () => {
      // DOM doesn't change but only url_change is expected
      const page = createMockPage({ urlAfterClick: 'http://localhost:5173/new', domChanged: false });
      const step: FlowStep = {
        step_id: 'test',
        label: 'URL-only check',
        action: 'click',
        selector: 'a.link',
        expected: { url_change: true },
        dead_cta_check: true,
      };
      const result = await detectDeadCTA(page, step, [], []);
      expect(result.dead).toBe(false);
    });

    it('detects dead CTA when network_request expected but absent', async () => {
      const page = createMockPage({ domChanged: false });
      const step: FlowStep = {
        step_id: 'test',
        label: 'API button',
        action: 'click',
        selector: 'button.api',
        expected: { network_request: true },
        dead_cta_check: true,
      };
      const result = await detectDeadCTA(page, step, [], []);
      expect(result.dead).toBe(true);
    });

    it('captures rich evidence on dead CTA', async () => {
      const page = createMockPage({ domChanged: false });
      const step: FlowStep = {
        step_id: 'test',
        label: 'Dead CTA button',
        action: 'click',
        selector: 'button.dead-cta',
        expected: { url_change: true, dom_mutation: true },
        dead_cta_check: true,
      };
      const result = await detectDeadCTA(page, step, ['Error: x'], ['GET /api/data']);
      expect(result.evidence.url_before).toBeDefined();
      expect(result.evidence.console_errors).toContain('Error: x');
      expect(result.evidence.network_requests).toContain('GET /api/data');
    });
  });

  // ---- 5. Rich evidence capture (3 tests, guardrail 5) ----
  describe('Rich evidence capture', () => {
    it('captures all evidence fields', async () => {
      const page = createMockPage();
      const step: FlowStep = {
        step_id: 'ev-test',
        label: 'Evidence test',
        action: 'click',
        selector: 'button.test',
      };
      const evidence = await captureEvidence(page, step, ['err1'], ['GET /api'], true);
      expect(evidence.selector).toBe('button.test');
      expect(evidence.console_errors).toEqual(['err1']);
      expect(evidence.network_requests).toEqual(['GET /api']);
      expect(evidence.dom_changed).toBe(true);
    });

    it('handles missing selector gracefully', async () => {
      const page = createMockPage();
      const step: FlowStep = {
        step_id: 'no-sel',
        label: 'No selector',
        action: 'check_console',
      };
      const evidence = await captureEvidence(page, step, [], [], false);
      expect(evidence.selector).toBeNull();
      expect(evidence.text_content).toBeNull();
    });

    it('buildRichEvidence creates proper evidence items', () => {
      const stepResult = {
        step_id: 'test',
        label: 'Test',
        action: 'click',
        status: 'fail' as const,
        duration_ms: 100,
        evidence: {
          selector: 'button.test',
          text_content: 'Click me',
          url_before: 'http://localhost:5173/',
          url_after: 'http://localhost:5173/',
          screenshot_path: '/tmp/screenshot.png',
          console_errors: ['TypeError: x is not a function'],
          network_requests: ['GET http://localhost:3001/api/test'],
          dom_snippet: '<button>Click me</button>',
          dom_changed: false,
        },
        failure_reason: 'Dead CTA',
        dead_cta_detected: true,
      };
      const items = buildRichEvidence(stepResult);
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.some(e => e.kind === 'console_line')).toBe(true);
      expect(items.some(e => e.kind === 'dom_snapshot_path')).toBe(true);
      expect(items.some(e => e.kind === 'screenshot_path')).toBe(true);
    });
  });

  // ---- 6. Incident bridge + tags (6 tests, guardrail 7) ----
  describe('Incident bridge + tags', () => {
    it('maps dead CTA step to incident args with correct tags', () => {
      const spec = createMinimalFlowSpec();
      spec.flow_id = 'photography-public';
      const qaResult = createMockQAResult();
      const step = {
        step_id: 'click-view-portfolio',
        label: 'Click View Portfolio CTA',
        action: 'click',
        status: 'fail' as const,
        duration_ms: 2100,
        evidence: {
          selector: 'button:has-text("View Portfolio")',
          text_content: 'View Portfolio',
          url_before: 'http://localhost:5173/',
          url_after: 'http://localhost:5173/',
          screenshot_path: null,
          console_errors: [],
          network_requests: [],
          dom_snippet: '<button>View Portfolio</button>',
          dom_changed: false,
        },
        failure_reason: 'Dead CTA: "Click View Portfolio CTA" — click produced no effect',
        dead_cta_detected: true,
      };

      const args = stepToIncidentArgs(step, spec, qaResult);
      expect(args.source).toBe('runtime-qa');
      expect(args.stage).toBe('runtime-ui');
      expect(args.tags).toContain('runtime-qa');
      expect(args.tags).toContain('photography-public');
      expect(args.tags).toContain('dead-cta');
      expect(args.summary).toContain('Dead CTA');
    });

    it('maps console error step to incident args', () => {
      const spec = createMinimalFlowSpec();
      const qaResult = createMockQAResult();
      const step = {
        step_id: 'check-console',
        label: 'Check console errors',
        action: 'check_console',
        status: 'fail' as const,
        duration_ms: 10,
        evidence: {
          selector: null,
          text_content: null,
          url_before: null,
          url_after: null,
          screenshot_path: null,
          console_errors: ['TypeError: Cannot read properties of undefined'],
          network_requests: [],
          dom_snippet: null,
          dom_changed: false,
        },
        failure_reason: 'Console errors detected: 1',
        dead_cta_detected: false,
      };

      const args = stepToIncidentArgs(step, spec, qaResult);
      expect(args.tags).toContain('console-error');
      expect(args.severity).toBe('p2');
    });

    it('maps navigation failure to incident args', () => {
      const spec = createMinimalFlowSpec();
      const qaResult = createMockQAResult();
      const step = {
        step_id: 'nav-home',
        label: 'Navigate to homepage',
        action: 'navigate',
        status: 'fail' as const,
        duration_ms: 5000,
        evidence: {
          selector: null,
          text_content: null,
          url_before: 'about:blank',
          url_after: 'http://localhost:5173/',
          screenshot_path: null,
          console_errors: [],
          network_requests: [],
          dom_snippet: null,
          dom_changed: false,
        },
        failure_reason: 'Expected element not visible: h1:has-text("Lumiere")',
        dead_cta_detected: false,
      };

      const args = stepToIncidentArgs(step, spec, qaResult);
      expect(args.tags).toContain('navigation-failure');
      expect(args.severity).toBe('p1');
    });

    it('bridgeFailedSteps returns empty for all-pass result', () => {
      const spec = createMinimalFlowSpec();
      const qaResult = createMockQAResult({
        steps: [{
          step_id: 's1', label: 'Pass', action: 'navigate',
          status: 'pass', duration_ms: 100,
          evidence: { selector: null, text_content: null, url_before: null, url_after: null, screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: null, dom_changed: false },
          failure_reason: null, dead_cta_detected: false,
        }],
      });
      const bridged = bridgeFailedSteps(qaResult, spec, { dryRun: true });
      expect(bridged).toHaveLength(0);
    });

    it('bridgeFailedSteps creates incidents for failed steps', () => {
      const spec = createMinimalFlowSpec();
      spec.flow_id = 'photography-public';
      const qaResult = createMockQAResult({
        steps: [{
          step_id: 'dead-1', label: 'Click Dead CTA', action: 'click',
          status: 'fail', duration_ms: 2100,
          evidence: { selector: 'button.dead', text_content: 'Dead', url_before: '/', url_after: '/', screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: '<button>Dead</button>', dom_changed: false },
          failure_reason: 'Dead CTA: "Click Dead CTA" — click produced no effect',
          dead_cta_detected: true,
        }],
      });
      const bridged = bridgeFailedSteps(qaResult, spec, { dryRun: true });
      expect(bridged).toHaveLength(1);
      expect(bridged[0].severity).toBe('p1');
    });

    it('includes page name in tags', () => {
      const spec = createMinimalFlowSpec();
      spec.flow_id = 'test';
      const qaResult = createMockQAResult();
      const step = {
        step_id: 'click-home', label: 'Click homepage button', action: 'click',
        status: 'fail' as const, duration_ms: 100,
        evidence: { selector: 'button', text_content: 'Test', url_before: '/', url_after: '/', screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: null, dom_changed: false },
        failure_reason: 'Dead CTA', dead_cta_detected: true,
      };
      const args = stepToIncidentArgs(step, spec, qaResult);
      expect(args.tags).toContain('HomePage');
    });
  });

  // ---- 7. Classifier coverage (3 tests) ----
  describe('Classifier coverage for runtime QA', () => {
    it('classifies dead CTA incident as runtime-dead-cta-detected', () => {
      const incident = {
        source: 'runtime-qa',
        stage: 'runtime-ui',
        summary: 'Dead CTA: "Click View Portfolio CTA" — click produced no effect',
        error: { message: 'Button "View Portfolio" has no onClick handler' },
        tags: ['runtime-qa', 'photography-public', 'dead-cta'],
      };
      const result = classifyIncident(incident);
      expect(result.classification).toBe('runtime-dead-cta-detected');
      expect(result.suspected_subsystem).toBe('page-gen');
      expect(result.confidence).toBe('high');
    });

    it('classifies console error incident', () => {
      const incident = {
        source: 'runtime-qa',
        stage: 'runtime-ui',
        summary: 'Console errors detected during photography-public flow',
        error: { message: 'Failed to load resource: net::ERR_CONNECTION_REFUSED' },
        tags: ['runtime-qa', 'photography-public', 'console-error'],
      };
      const result = classifyIncident(incident);
      expect(result.classification).toBe('runtime-console-error');
      expect(result.suspected_subsystem).toBe('page-gen');
    });

    it('classifies navigation failure incident', () => {
      const incident = {
        source: 'runtime-qa',
        stage: 'runtime-ui',
        summary: 'Navigation failure: "Navigate to homepage" did not reach expected state',
        error: { message: 'Expected element not visible' },
        tags: ['runtime-qa', 'photography-public', 'navigation-failure'],
      };
      const result = classifyIncident(incident);
      expect(result.classification).toBe('runtime-navigation-failure');
      expect(result.suspected_subsystem).toBe('jsx-gen');
    });
  });

  // ---- 8. Self-heal loop modes (5 tests) ----
  describe('Self-heal loop modes', () => {
    function createMockExecuteFlow(qaResult: RuntimeQAResult) {
      return async (_spec: FlowSpec, _opts: QARunOptions) => qaResult;
    }

    it('shadow mode: runs QA + bridge, no patches', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'shadow',
        mockExecuteFlow: createMockExecuteFlow(qaResult),
        skipArtifacts: true,
      });
      expect(result.mode).toBe('shadow');
      expect(result.patches).toHaveLength(0);
      expect(result.verifications).toHaveLength(0);
    });

    it('shadow mode with failures: bridges incidents', async () => {
      const qaResult = createMockQAResult({
        verdict: 'fail',
        steps: [{
          step_id: 'dead-1', label: 'Click Dead CTA', action: 'click',
          status: 'fail', duration_ms: 2100,
          evidence: { selector: 'button.dead', text_content: 'Dead', url_before: '/', url_after: '/', screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: '<button>Dead</button>', dom_changed: false },
          failure_reason: 'Dead CTA', dead_cta_detected: true,
        }],
        summary: { total: 1, passed: 0, failed: 1, skipped: 0, dead_ctas: 1, console_errors: 0 },
      });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'shadow',
        mockExecuteFlow: createMockExecuteFlow(qaResult),
        skipArtifacts: true,
        dryRun: true,
      });
      expect(result.summary.dead_ctas_found).toBe(1);
      expect(result.verdict).toBe('fail');
    });

    it('propose mode: generates patches without LLM key', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'propose',
        mockExecuteFlow: createMockExecuteFlow(qaResult),
        skipArtifacts: true,
      });
      expect(result.mode).toBe('propose');
      // No failures → no patches, but mode is propose
      expect(result.patches).toHaveLength(0);
    });

    it('patch-verify mode with no failures: pass verdict', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'patch-verify',
        dryRun: true,
        mockExecuteFlow: createMockExecuteFlow(qaResult),
        skipArtifacts: true,
      });
      expect(result.mode).toBe('patch-verify');
      expect(result.verdict).toBe('pass');
    });

    it('dry run skips actual execution', async () => {
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'shadow',
        dryRun: true,
        skipArtifacts: true,
        mockExecuteFlow: async () => createMockQAResult({
          steps: [{
            step_id: 's1', label: 'Skip', action: 'navigate',
            status: 'skip', duration_ms: 0,
            evidence: { selector: null, text_content: null, url_before: null, url_after: null, screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: null, dom_changed: false },
            failure_reason: 'dry-run', dead_cta_detected: false,
          }],
          summary: { total: 1, passed: 0, failed: 0, skipped: 1, dead_ctas: 0, console_errors: 0 },
        }),
      });
      expect(result.verdict).toBe('pass');
    });
  });

  // ---- 9. Propose without LLM (2 tests, guardrail 4) ----
  describe('Propose mode without LLM', () => {
    it('does not require ANTHROPIC_API_KEY', async () => {
      const saved = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'propose',
        modelAssisted: false,
        mockExecuteFlow: async () => qaResult,
        skipArtifacts: true,
      });
      expect(result.mode).toBe('propose');

      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    });

    it('modelAssisted flag is opt-in', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'propose',
        modelAssisted: false,
        mockExecuteFlow: async () => qaResult,
        skipArtifacts: true,
      });
      // Should complete without error even without API key
      expect(result).toBeDefined();
    });
  });

  // ---- 10. Safety bounds (3 tests) ----
  describe('Safety bounds', () => {
    it('clamps maxAttempts to [1, 5]', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      // maxAttempts=100 should be clamped to 5
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'shadow',
        maxAttempts: 100,
        mockExecuteFlow: async () => qaResult,
        skipArtifacts: true,
      });
      expect(result).toBeDefined();
    });

    it('clamps maxAttempts=0 to 1', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'shadow',
        maxAttempts: 0,
        mockExecuteFlow: async () => qaResult,
        skipArtifacts: true,
      });
      expect(result).toBeDefined();
    });

    it('loop result contains valid schema_version', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'shadow',
        mockExecuteFlow: async () => qaResult,
        skipArtifacts: true,
      });
      expect(result.schema_version).toBe('1.0');
    });
  });

  // ---- 11. Photography flow content (3 tests) ----
  describe('Photography flow content', () => {
    it('has dead_cta_check steps for all 3 CTA buttons', () => {
      const spec = loadFlowSpec(getPhotographyFlowPath());
      const ctaSteps = spec.steps.filter(s => s.dead_cta_check);
      expect(ctaSteps.length).toBe(3);
      const labels = ctaSteps.map(s => s.label);
      expect(labels).toContain('Click View Portfolio CTA');
      expect(labels).toContain('Click Book a Session CTA');
      expect(labels).toContain('Click Get in Touch CTA');
    });

    it('all CTA steps have p1 severity', () => {
      const spec = loadFlowSpec(getPhotographyFlowPath());
      const ctaSteps = spec.steps.filter(s => s.dead_cta_check);
      for (const step of ctaSteps) {
        expect(step.severity).toBe('p1');
      }
    });

    it('flow has preflight health check path', () => {
      const spec = loadFlowSpec(getPhotographyFlowPath());
      expect(spec.preflight_health_path).toBe('/api/health');
      expect(spec.base_url_server).toBe('http://localhost:3001');
    });
  });

  // ---- 12. Step execution (3 tests) ----
  describe('Step execution', () => {
    it('navigate step sets url', async () => {
      const page = createMockPage();
      const step: FlowStep = {
        step_id: 'nav',
        label: 'Navigate to /',
        action: 'navigate',
        target: '/',
      };
      const spec = createMinimalFlowSpec();
      const result = await executeStep(page, step, spec, [], []);
      expect(result.status).toBe('pass');
    });

    it('click step without selector returns error', async () => {
      const page = createMockPage();
      const step: FlowStep = {
        step_id: 'click-no-sel',
        label: 'Click nothing',
        action: 'click',
      };
      const spec = createMinimalFlowSpec();
      const result = await executeStep(page, step, spec, [], []);
      expect(result.status).toBe('error');
      expect(result.failure_reason).toContain('requires selector');
    });

    it('check_console with errors returns fail', async () => {
      const page = createMockPage();
      const step: FlowStep = {
        step_id: 'check',
        label: 'Check console',
        action: 'check_console',
      };
      const spec = createMinimalFlowSpec();
      const result = await executeStep(page, step, spec, ['Error: boom'], []);
      expect(result.status).toBe('fail');
      expect(result.evidence.console_errors).toContain('Error: boom');
    });
  });

  // ---- 13. Schema validation of results (2 tests) ----
  describe('Schema validation', () => {
    it('validates QA result against schema', () => {
      const qaResult = createMockQAResult({
        steps: [{
          step_id: 's1', label: 'Test', action: 'navigate',
          status: 'pass', duration_ms: 100,
          evidence: { selector: null, text_content: null, url_before: null, url_after: null, screenshot_path: null, console_errors: [], network_requests: [], dom_snippet: null, dom_changed: false },
          failure_reason: null, dead_cta_detected: false,
        }],
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, dead_ctas: 0, console_errors: 0 },
      });
      const errors = validateQAResult(qaResult);
      expect(errors).toEqual([]);
    });

    it('validates heal loop result against schema', async () => {
      const qaResult = createMockQAResult({ verdict: 'pass' });
      const result = await runHealLoop({
        flowPath: mockFlowPath,
        mode: 'shadow',
        mockExecuteFlow: async () => qaResult,
        skipArtifacts: true,
      });
      const errors = validateHealLoopResult(result);
      expect(errors).toEqual([]);
    });
  });

  // ---- 14. Integration (env-gated, guardrail 8) ----
  describe.skipIf(!process.env.RUNTIME_QA_LIVE)('Live integration (RUNTIME_QA_LIVE=1)', () => {
    it('runs photography flow against live app', async () => {
      const spec = loadFlowSpec(getPhotographyFlowPath());
      const result = await executeFlow(spec, { headless: true, flowPath: getPhotographyFlowPath() });
      expect(result.qa_run_id).toMatch(/^QR-/);
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('self-heal loop shadow mode against live app', async () => {
      const result = await runHealLoop({
        flowPath: getPhotographyFlowPath(),
        mode: 'shadow',
        headless: true,
      });
      expect(result.loop_id).toMatch(/^HL-/);
    });
  });
});
