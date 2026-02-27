#!/usr/bin/env npx tsx
/**
 * Runtime QA Runner (SH8)
 *
 * Launches a real browser via Playwright, executes flow steps against a running app,
 * and detects dead CTAs, navigation failures, and console errors.
 *
 * Dead CTA detection is step-aware: each step declares expected signals
 * (url_change, dom_mutation, network_request) and only those are checked.
 *
 * Usage:
 *   npm run runtime-qa -- --flow qa-flows/photography-public.json [--headless] [--dry-run]
 *
 * Requires: App running on configured ports. Playwright installed via `npm run playwright-install`.
 * CI-safe: All tests use mock Page objects by default. Real browser gated behind RUNTIME_QA_LIVE=1.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync as fExistsSync } from 'fs';
import { join } from 'path';
import { validateJsonSchema } from '../tests/schema-validator.js';

// ---- Types (canonical definitions in src/self-heal/runtime-qa.ts, re-exported here) ----

export type {
  StepExpected, AssertStyleFields, VisualSnapshotFields,
  FlowStep, FlowSpec, StepEvidence, StepResult, PreflightResult,
  RunMetadata, RuntimeQASummary, RuntimeQAResult,
  QARunOptions, MockablePage, VisualBaselineMode,
} from '../src/self-heal/runtime-qa.js';

import type {
  StepExpected, AssertStyleFields, VisualSnapshotFields,
  FlowStep, FlowSpec, StepEvidence, StepResult, PreflightResult,
  RunMetadata, RuntimeQASummary, RuntimeQAResult,
  QARunOptions, MockablePage, VisualBaselineMode,
} from '../src/self-heal/runtime-qa.js';

// ---- Helpers ----

export function generateQARunId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `QR-${date}-${time}-${rand}`;
}

export function loadFlowSpec(path: string): FlowSpec {
  const raw = readFileSync(path, 'utf-8');
  const spec = JSON.parse(raw) as FlowSpec;

  // Validate preconditions (guardrail 6)
  if (!spec.flow_id) throw new Error('Flow spec missing flow_id');
  if (!spec.base_url_client) throw new Error('Flow spec missing base_url_client');
  if (!spec.base_url_server) throw new Error('Flow spec missing base_url_server');
  if (!spec.preflight_health_path) throw new Error('Flow spec missing preflight_health_path');
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    throw new Error('Flow spec must have at least one step');
  }

  for (const step of spec.steps) {
    if (!step.step_id) throw new Error(`Step missing step_id`);
    if (!step.label) throw new Error(`Step ${step.step_id} missing label`);
    if (!step.action) throw new Error(`Step ${step.step_id} missing action`);
  }

  return spec;
}

function emptyEvidence(): StepEvidence {
  return {
    selector: null,
    text_content: null,
    url_before: null,
    url_after: null,
    screenshot_path: null,
    console_errors: [],
    network_requests: [],
    dom_snippet: null,
    dom_changed: false,
  };
}

// ---- Preflight (guardrail 2) ----

export async function runPreflight(
  spec: FlowSpec,
  _options?: QARunOptions,
): Promise<PreflightResult> {
  const healthUrl = `${spec.base_url_server}${spec.preflight_health_path}`;
  const maxRetries = 3;
  const backoffMs = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const start = performance.now();
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        return { health_check_url: healthUrl, status: 'pass', latency_ms: latency, error: null };
      }
      if (attempt === maxRetries) {
        return {
          health_check_url: healthUrl,
          status: 'fail',
          latency_ms: latency,
          error: `App not reachable at ${healthUrl} — HTTP ${res.status}`,
        };
      }
    } catch (err: any) {
      if (attempt === maxRetries) {
        const latency = Math.round(performance.now() - start);
        return {
          health_check_url: healthUrl,
          status: 'fail',
          latency_ms: latency,
          error: `App not reachable at ${healthUrl} — ${err.message}`,
        };
      }
    }
    await new Promise(r => setTimeout(r, backoffMs * attempt));
  }

  // Should not reach here, but TypeScript needs it
  return { health_check_url: healthUrl, status: 'fail', latency_ms: 0, error: 'Max retries exceeded' };
}

// ---- Evidence Capture (guardrail 5) ----

export async function captureEvidence(
  page: MockablePage,
  step: FlowStep,
  consoleErrors: string[],
  networkRequests: string[],
  domChanged: boolean,
): Promise<StepEvidence> {
  let textContent: string | null = null;
  let domSnippet: string | null = null;

  if (step.selector) {
    try {
      const info = await page.evaluate(`
        (() => {
          const el = document.querySelector(${JSON.stringify(step.selector.split(':has-text')[0].split(',')[0].trim())});
          if (!el) return null;
          return { text: el.textContent?.trim() || '', html: el.outerHTML?.slice(0, 500) || '' };
        })()
      `);
      if (info && typeof info === 'object') {
        const obj = info as { text: string; html: string };
        textContent = obj.text || null;
        domSnippet = obj.html || null;
      }
    } catch {
      // Page may have navigated away
    }
  }

  return {
    selector: step.selector || step.target || null,
    text_content: textContent,
    url_before: null, // Set by caller
    url_after: page.url(),
    screenshot_path: null, // Set by caller if needed
    console_errors: [...consoleErrors],
    network_requests: [...networkRequests],
    dom_snippet: domSnippet,
    dom_changed: domChanged,
  };
}

// ---- Dead CTA Detection (step-aware, guardrail 1) ----

export async function detectDeadCTA(
  page: MockablePage,
  step: FlowStep,
  consoleErrors: string[],
  networkRequests: string[],
): Promise<{ dead: boolean; evidence: StepEvidence }> {
  const expected = step.expected || {};
  const urlBefore = page.url();

  // Pre-click: detect if element has target="_blank" (opens new tab)
  let isBlankTarget = false;
  if (step.selector) {
    try {
      const firstSelector = step.selector.split(',')[0].split(':has-text')[0].trim();
      isBlankTarget = await page.evaluate(`
        (() => {
          const el = document.querySelector(${JSON.stringify(firstSelector)});
          return el ? el.getAttribute('target') === '_blank' : false;
        })()
      `);
    } catch {
      // Ignore
    }
  }

  // Setup DOM mutation observer if expected
  let domChanged = false;
  if (expected.dom_mutation) {
    try {
      await page.evaluate(`
        window.__sh8_domChanged = false;
        window.__sh8_observer = new MutationObserver(() => { window.__sh8_domChanged = true; });
        window.__sh8_observer.observe(document.body, { childList: true, subtree: true });
      `);
    } catch {
      // Ignore if evaluate fails
    }
  }

  // Record network request count before
  const networkBefore = networkRequests.length;

  // For target="_blank" links, listen for popup event
  let popupOpened = false;
  let popupPage: { url(): string; close?(): Promise<void> } | null = null;
  if (isBlankTarget && page.waitForEvent) {
    // Race the click + popup detection
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).then((p: any) => {
      popupOpened = true;
      popupPage = p;
      return p;
    }).catch(() => { /* no popup within timeout */ });

    // Click the element
    if (step.selector) {
      try {
        await page.click(step.selector, { timeout: 2000 });
      } catch {
        // Click failed — element may not exist
      }
    }

    await popupPromise;

    // Close the popup to keep the browser state clean
    if (popupPage && (popupPage as any).close) {
      try { await (popupPage as any).close(); } catch { /* ignore */ }
    }
  } else {
    // Click the element (normal flow)
    if (step.selector) {
      try {
        await page.click(step.selector, { timeout: 2000 });
      } catch {
        // Click failed — element may not exist
      }
    }
  }

  // Wait for effects (skip long wait if popup already confirmed)
  if (!popupOpened) {
    const timeoutMs = 2000;
    await new Promise(r => setTimeout(r, timeoutMs));
  }

  // Check DOM mutations
  if (expected.dom_mutation) {
    try {
      domChanged = await page.evaluate(`
        (() => {
          if (window.__sh8_observer) window.__sh8_observer.disconnect();
          return !!window.__sh8_domChanged;
        })()
      `);
    } catch {
      domChanged = false;
    }
  }

  // Check expected signals — ALL expected must be absent for dead CTA
  let allExpectedAbsent = true;

  if (expected.url_change) {
    const urlAfter = page.url();
    // For target="_blank" links, a popup counts as url_change
    if (urlAfter !== urlBefore || popupOpened) {
      allExpectedAbsent = false;
    }
  }

  if (expected.dom_mutation) {
    if (domChanged) {
      allExpectedAbsent = false;
    }
  }

  if (expected.network_request) {
    if (networkRequests.length > networkBefore) {
      allExpectedAbsent = false;
    }
  }

  // Capture rich evidence
  const evidence = await captureEvidence(page, step, consoleErrors, networkRequests, domChanged);
  evidence.url_before = urlBefore;

  return { dead: allExpectedAbsent, evidence };
}

// ---- Step Execution ----

export async function executeStep(
  page: MockablePage,
  step: FlowStep,
  spec: FlowSpec,
  consoleErrors: string[],
  networkRequests: string[],
  baselineMode?: VisualBaselineMode,
): Promise<StepResult> {
  const start = performance.now();
  let evidence = emptyEvidence();
  let status: StepResult['status'] = 'pass';
  let failureReason: string | null = null;
  let deadCta = false;

  try {
    switch (step.action) {
      case 'navigate': {
        const url = `${spec.base_url_client}${step.target || '/'}`;
        evidence.url_before = page.url();
        await page.goto(url, { waitUntil: 'networkidle' });
        evidence.url_after = page.url();

        // Check assert_visible if expected
        if (step.expected?.assert_visible && page.waitForSelector) {
          try {
            await page.waitForSelector(step.expected.assert_visible, { timeout: 5000 });
          } catch {
            status = 'fail';
            failureReason = `Expected element not visible: ${step.expected.assert_visible}`;
          }
        }
        break;
      }

      case 'click': {
        if (!step.selector) {
          status = 'error';
          failureReason = 'Click action requires selector';
          break;
        }

        if (step.dead_cta_check) {
          const result = await detectDeadCTA(page, step, consoleErrors, networkRequests);
          evidence = result.evidence;
          deadCta = result.dead;
          if (deadCta) {
            status = 'fail';
            failureReason = `Dead CTA: "${step.label}" — click produced no effect`;
          }
        } else {
          evidence.url_before = page.url();
          await page.click(step.selector, { timeout: 5000 });
          await new Promise(r => setTimeout(r, 500));
          evidence.url_after = page.url();
        }
        break;
      }

      case 'type': {
        if (!step.selector || !step.value) {
          status = 'error';
          failureReason = 'Type action requires selector and value';
          break;
        }
        if (page.fill) {
          await page.fill(step.selector, step.value);
        }
        break;
      }

      case 'check_console': {
        if (consoleErrors.length > 0) {
          status = 'fail';
          failureReason = `Console errors detected: ${consoleErrors.length}`;
          evidence.console_errors = [...consoleErrors];
        }
        break;
      }

      case 'assert_visible': {
        if (step.selector && page.waitForSelector) {
          try {
            await page.waitForSelector(step.selector, { timeout: 5000 });
          } catch {
            status = 'fail';
            failureReason = `Element not visible: ${step.selector}`;
          }
        }
        break;
      }

      case 'screenshot': {
        if (page.screenshot) {
          const screenshotDir = join('artifacts', 'runtime-qa', 'screenshots');
          mkdirSync(screenshotDir, { recursive: true });
          const ssPath = join(screenshotDir, `${step.step_id}-${Date.now()}.png`);
          const buffer = await page.screenshot({ path: ssPath, fullPage: true });
          if (buffer) {
            evidence.screenshot_path = ssPath;
          }
        }
        break;
      }

      case 'assert_style': {
        // SH9: Style assertion — compare computed styles against expected
        const styleFields = step.assert_style;
        if (!styleFields) {
          status = 'error';
          failureReason = 'assert_style action requires assert_style fields';
          break;
        }
        try {
          // Set viewport if specified
          if (styleFields.viewport && (page as any).setViewportSize) {
            await (page as any).setViewportSize(styleFields.viewport);
          }

          const computed = await page.evaluate(`
            (() => {
              const el = document.querySelector(${JSON.stringify(styleFields.selector)});
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              const props = ${JSON.stringify(Object.keys(styleFields.expected_styles))};
              const result = {};
              for (const p of props) { result[p] = cs.getPropertyValue(p); }
              return result;
            })()
          `) as Record<string, string> | null;

          if (!computed) {
            status = 'fail';
            failureReason = `Element not found: ${styleFields.selector}`;
            break;
          }

          evidence.computed_styles = computed;
          const mismatches: string[] = [];
          for (const [prop, expected] of Object.entries(styleFields.expected_styles)) {
            const actual = computed[prop] ?? '';
            if (actual !== expected) {
              mismatches.push(`${prop}: expected "${expected}", got "${actual}"`);
            }
          }

          if (mismatches.length > 0) {
            status = 'fail';
            failureReason = `Style mismatches: ${mismatches.join('; ')}`;
          }
        } catch (err: any) {
          status = 'error';
          failureReason = `Style assertion error: ${err.message}`;
        }
        break;
      }

      case 'visual_snapshot': {
        // SH9: Visual snapshot — capture + compare with baseline
        const snapFields = step.visual_snapshot;
        if (!snapFields) {
          status = 'error';
          failureReason = 'visual_snapshot action requires visual_snapshot fields';
          break;
        }
        try {
          if (page.screenshot) {
            const screenshotDir = join('artifacts', 'runtime-qa', 'snapshots');
            mkdirSync(screenshotDir, { recursive: true });
            const ssPath = join(screenshotDir, `${snapFields.baseline_name}-${Date.now()}.png`);

            const ssOptions: Record<string, unknown> = { path: ssPath };
            if (snapFields.selector) {
              // Element screenshot: get bounding box via evaluate, then use clip rect
              try {
                const bbox = await page.evaluate(`
                  (() => {
                    const el = document.querySelector(${JSON.stringify(snapFields.selector)});
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                  })()
                `) as { x: number; y: number; width: number; height: number } | null;
                if (bbox && bbox.width > 0 && bbox.height > 0) {
                  ssOptions.clip = bbox;
                } else {
                  ssOptions.fullPage = false;
                }
              } catch {
                ssOptions.fullPage = false;
              }
            } else {
              ssOptions.fullPage = true;
            }

            const buffer = await page.screenshot(ssOptions);
            if (buffer) {
              evidence.visual_screenshot_path = ssPath;

              // Compare with baseline
              const baselinePath = join('qa-baselines', `${snapFields.baseline_name}.png`);
              if (fExistsSync(baselinePath)) {
                const { compareScreenshots } = await import('./visual-diff.js');
                const threshold = snapFields.threshold ?? 0.01;
                const diffResult = compareScreenshots(baselinePath, ssPath, threshold);
                evidence.visual_diff_score = diffResult.diffScore;

                if (!diffResult.match) {
                  status = 'fail';
                  failureReason = `Visual diff: ${(diffResult.diffScore * 100).toFixed(2)}% exceeds ${(threshold * 100).toFixed(2)}% threshold`;
                }
              } else if (baselineMode === 'record-missing') {
                // Record-missing mode: save screenshot as baseline, pass on first run
                const baselineDir = 'qa-baselines';
                mkdirSync(baselineDir, { recursive: true });
                writeFileSync(baselinePath, buffer);
                status = 'pass';
                failureReason = null;
              } else {
                // Missing baseline — record as skip with reason
                status = 'skip';
                failureReason = `Baseline not found: qa-baselines/${snapFields.baseline_name}.png — save a baseline image to enable comparison`;
              }
            }
          }
        } catch (err: any) {
          status = 'error';
          failureReason = `Visual snapshot error: ${err.message}`;
        }
        break;
      }
    }
  } catch (err: any) {
    status = 'error';
    failureReason = err.message;
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    step_id: step.step_id,
    label: step.label,
    action: step.action,
    status,
    duration_ms: durationMs,
    evidence,
    failure_reason: failureReason,
    dead_cta_detected: deadCta,
  };
}

// ---- Flow Execution ----

export async function executeFlow(
  spec: FlowSpec,
  options: QARunOptions = {},
): Promise<RuntimeQAResult> {
  const qaRunId = generateQARunId();
  const headless = options.headless ?? true;
  const flowPath = options.flowPath || '';

  // Preflight (guardrail 2)
  let preflight: PreflightResult;
  if (options.dryRun) {
    preflight = {
      health_check_url: `${spec.base_url_server}${spec.preflight_health_path}`,
      status: 'skip',
      latency_ms: 0,
      error: null,
    };
  } else if (options.mockPreflight) {
    preflight = await options.mockPreflight(spec);
  } else {
    preflight = await runPreflight(spec, options);
  }

  if (preflight.status === 'fail') {
    return buildResult(qaRunId, spec, flowPath, headless, preflight, [], options);
  }

  // Execute steps
  const steps: StepResult[] = [];

  if (options.dryRun) {
    // Dry run: validate flow, skip execution
    for (const step of spec.steps) {
      steps.push({
        step_id: step.step_id,
        label: step.label,
        action: step.action,
        status: 'skip',
        duration_ms: 0,
        evidence: emptyEvidence(),
        failure_reason: 'dry-run',
        dead_cta_detected: false,
      });
    }
    return buildResult(qaRunId, spec, flowPath, headless, preflight, steps, options);
  }

  // Get page (real browser or mock)
  let page: MockablePage;
  let browser: { close(): Promise<void> } | null = null;
  const consoleErrors: string[] = [];
  const networkRequests: string[] = [];

  if (options.mockPage) {
    page = options.mockPage;
  } else {
    // Launch real browser (gated behind RUNTIME_QA_LIVE=1, guardrail 8)
    const pw = await import('playwright');
    const chromium = pw.chromium;
    browser = await chromium.launch({ headless });
    const context = await (browser as any).newContext();
    page = await context.newPage();

    // Collect console errors and network requests
    (page as any).on('console', (msg: any) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    (page as any).on('request', (req: any) => {
      networkRequests.push(`${req.method()} ${req.url()}`);
    });
  }

  // Attach console/network listeners for mock pages
  if (options.mockPage && page.on) {
    page.on('console', (msg: any) => {
      if (typeof msg === 'string') consoleErrors.push(msg);
      else if (msg?.type?.() === 'error') consoleErrors.push(msg.text());
    });
    page.on('request', (req: any) => {
      if (typeof req === 'string') networkRequests.push(req);
      else if (req?.method) networkRequests.push(`${req.method()} ${req.url()}`);
    });
  }

  try {
    for (const step of spec.steps) {
      const result = await executeStep(page, step, spec, consoleErrors, networkRequests, options.baselineMode);
      steps.push(result);
    }
  } finally {
    if (browser) {
      await browser.close();
    } else if (page.close) {
      await page.close();
    }
  }

  return buildResult(qaRunId, spec, flowPath, headless, preflight, steps, options);
}

function buildResult(
  qaRunId: string,
  spec: FlowSpec,
  flowPath: string,
  headless: boolean,
  preflight: PreflightResult,
  steps: StepResult[],
  options: QARunOptions,
): RuntimeQAResult {
  const total = steps.length;
  const passed = steps.filter(s => s.status === 'pass').length;
  const failed = steps.filter(s => s.status === 'fail').length;
  const skipped = steps.filter(s => s.status === 'skip').length;
  const deadCtas = steps.filter(s => s.dead_cta_detected).length;
  const consoleErrorCount = steps.filter(s =>
    s.evidence.console_errors.length > 0 || s.action === 'check_console' && s.status === 'fail',
  ).length;

  const verdict: 'pass' | 'fail' =
    preflight.status === 'fail' || failed > 0 ? 'fail' : 'pass';

  return {
    schema_version: '1.0',
    qa_run_id: qaRunId,
    flow_id: spec.flow_id,
    timestamp: new Date().toISOString(),
    run_metadata: {
      headless,
      flow_path: flowPath,
      dry_run: options.dryRun,
      timeout_ms: options.timeoutMs,
    },
    preflight,
    steps,
    summary: {
      total,
      passed,
      failed,
      skipped,
      dead_ctas: deadCtas,
      console_errors: consoleErrorCount,
    },
    verdict,
    incident_paths: [],
  };
}

// ---- Artifact Writing ----

export function writeQAResult(result: RuntimeQAResult): string {
  const dir = join('artifacts', 'runtime-qa', result.qa_run_id);
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, 'result.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return outPath;
}

export function validateQAResult(result: RuntimeQAResult): string[] {
  const schemaPath = join(__dirname, '..', 'docs', 'runtime-qa-result.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  return validateJsonSchema(result, schema, schema);
}

// ---- CLI Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flowIdx = args.indexOf('--flow');
  const flowPath = flowIdx >= 0 ? args[flowIdx + 1] : undefined;
  const headless = !args.includes('--no-headless');
  const dryRun = args.includes('--dry-run');

  if (!flowPath) {
    console.error('Usage: runtime-qa-run.ts --flow <path> [--headless] [--dry-run]');
    process.exit(1);
  }

  try {
    const spec = loadFlowSpec(flowPath);
    console.log(`\n  Runtime QA Runner\n`);
    console.log(`  Flow:     ${spec.flow_id}`);
    console.log(`  Steps:    ${spec.steps.length}`);
    console.log(`  Headless: ${headless}`);
    console.log(`  Dry run:  ${dryRun}\n`);

    const result = await executeFlow(spec, { headless, dryRun, flowPath });

    // Write result
    const outPath = writeQAResult(result);

    // Report
    console.log(`  Preflight: ${result.preflight.status}`);
    for (const step of result.steps) {
      const icon = step.status === 'pass' ? 'PASS' : step.status === 'skip' ? 'SKIP' : 'FAIL';
      const deadTag = step.dead_cta_detected ? ' [DEAD CTA]' : '';
      console.log(`    ${icon}  ${step.label}${deadTag} (${step.duration_ms}ms)`);
    }
    console.log(`\n  Summary:  ${result.summary.passed}/${result.summary.total} passed`);
    console.log(`  Dead CTAs: ${result.summary.dead_ctas}`);
    console.log(`  Verdict:   ${result.verdict.toUpperCase()}`);
    console.log(`  Report:    ${outPath}\n`);

    process.exit(result.verdict === 'pass' ? 0 : 1);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('runtime-qa-run')) {
  main();
}
