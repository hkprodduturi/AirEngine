/**
 * Auto QA Flow Generator (H10 — Batch 1)
 *
 * Generates a FlowSpec from a parsed .air AST. Produces navigate/click/type/check_console
 * steps covering nav routes, CTA buttons, forms, and console error checks.
 *
 * Selector strategy: prefers data-air-* hooks (Batch 2), falls back to text-based selectors.
 *
 * Ports default to air dev defaults (3000/3001). Frontend-only apps use clientPort for
 * both base URLs and preflight on '/' (H10 adjustment 3).
 */

import { parse } from '../parser/index.js';
import { extractContext, type TranspileContext } from '../transpiler/context.js';
import { analyzeUI, resolveBindChain, extractMutations, type UIAnalysis, type PageInfo } from '../transpiler/normalize-ui.js';
import { mapElement } from '../transpiler/element-map.js';
import type { FlowSpec, FlowStep } from './runtime-qa.js';
import type { AirUINode } from '../parser/types.js';

// ---- Options ----

export interface FlowGenOptions {
  clientPort?: number;      // default 3000 (aligned with air dev)
  serverPort?: number;      // default 3001
  preflightPath?: string;   // default: dynamic by app type
  styleLane?: boolean;      // default false
  visualLane?: boolean;     // default false
}

// ---- Main Entry ----

export function generateFlowSpec(source: string, options?: FlowGenOptions): FlowSpec {
  const ast = parse(source);
  const ctx = extractContext(ast);
  const analysis = analyzeUI(ctx.uiNodes);

  const clientPort = options?.clientPort ?? 3000;
  const serverPort = options?.serverPort ?? 3001;
  const styleLane = options?.styleLane ?? false;
  const visualLane = options?.visualLane ?? false;

  // Dynamic preflight by app type (H10 adjustment 3)
  const isBackend = ctx.hasBackend;
  const baseUrlClient = `http://localhost:${clientPort}`;
  const baseUrlServer = isBackend
    ? `http://localhost:${serverPort}`
    : `http://localhost:${clientPort}`;
  const preflightPath = options?.preflightPath
    ?? (isBackend ? '/api/health' : '/');

  const steps: FlowStep[] = [];
  let stepCounter = 0;

  function nextStepId(): string {
    stepCounter++;
    return `S${String(stepCounter).padStart(3, '0')}`;
  }

  // Step 1: Navigate to root
  steps.push({
    step_id: nextStepId(),
    label: 'Navigate to app root',
    action: 'navigate',
    target: '/',
    expected: { assert_visible: 'body' },
  });

  // Nav route steps
  for (const navRoute of ctx.navRoutes) {
    if (!navRoute.path || !navRoute.target) continue;

    // Prefer data-air-nav selector, fallback to text
    const selector = `[data-air-nav="${navRoute.target}"], button:has-text('${capitalize(navRoute.target)}'), a:has-text('${capitalize(navRoute.target)}')`;

    steps.push({
      step_id: nextStepId(),
      label: `Click nav: ${navRoute.target}`,
      action: 'click',
      selector,
      dead_cta_check: true,
      expected: { dom_mutation: true },
    });
  }

  // Page-level steps: for each page, navigate + interact with CTAs
  for (const page of analysis.pages) {
    // Navigate to page (via currentPage state, not URL routing)
    const pageSelector = `[data-air-nav="${page.name}"], button:has-text('${capitalize(page.name)}')`;
    steps.push({
      step_id: nextStepId(),
      label: `Navigate to page: ${page.name}`,
      action: 'click',
      selector: pageSelector,
      expected: { dom_mutation: true },
    });

    // Extract CTAs and forms from page children
    generatePageInteractionSteps(page, ctx, analysis, steps, nextStepId);
  }

  // Section-level interaction steps (for section-based apps without pages)
  if (!analysis.hasPages && analysis.sections.length > 0) {
    for (const section of analysis.sections) {
      generatePageInteractionSteps(section, ctx, analysis, steps, nextStepId);
    }
  }

  // Style lane steps
  if (styleLane) {
    // Check sidebar styling if layout is present
    if (analysis.hasPages && analysis.pages.length >= 3) {
      steps.push({
        step_id: nextStepId(),
        label: 'Assert sidebar styling',
        action: 'assert_style',
        assert_style: {
          selector: 'aside',
          expected_styles: { 'position': 'fixed' },
        },
      });
    }

    // Check button accent color
    steps.push({
      step_id: nextStepId(),
      label: 'Assert primary button styling',
      action: 'assert_style',
      assert_style: {
        selector: 'button',
        expected_styles: { 'cursor': 'pointer' },
      },
    });

    // Check heading exists
    steps.push({
      step_id: nextStepId(),
      label: 'Assert heading visibility',
      action: 'assert_visible',
      selector: 'h1, h2',
    });
  }

  // Visual lane steps
  if (visualLane) {
    steps.push({
      step_id: nextStepId(),
      label: 'Visual snapshot: app root',
      action: 'visual_snapshot',
      visual_snapshot: {
        baseline_name: `${ctx.appName}-root`,
        threshold: 0.02,
      },
    });

    if (analysis.hasPages && analysis.pages.length > 0) {
      steps.push({
        step_id: nextStepId(),
        label: `Visual snapshot: ${analysis.pages[0].name} page`,
        action: 'visual_snapshot',
        visual_snapshot: {
          baseline_name: `${ctx.appName}-${analysis.pages[0].name}`,
          threshold: 0.02,
        },
      });
    }
  }

  // ---- H11: Default layout/style assertions (always on for key views) ----

  // Header/nav visibility — every app should have a visible header or nav
  if (analysis.hasPages || ctx.navRoutes.length > 0) {
    steps.push({
      step_id: nextStepId(),
      label: 'Assert header/nav visible',
      action: 'assert_style',
      assert_style: {
        selector: '[data-air-nav], header, nav',
        expected_styles: { 'display': 'block|flex|grid' },
      },
    });
  }

  // Primary CTA group — buttons should be clickable (cursor: pointer)
  if (analysis.pages.length > 0 || analysis.sections.length > 0) {
    steps.push({
      step_id: nextStepId(),
      label: 'Assert primary CTA styling',
      action: 'assert_style',
      assert_style: {
        selector: '[data-air-cta], button[type="submit"], .btn-primary',
        expected_styles: { 'cursor': 'pointer' },
      },
    });
  }

  // Sidebar/main alignment — sidebar apps should have proper layout
  if (analysis.hasPages && analysis.pages.length >= 3) {
    steps.push({
      step_id: nextStepId(),
      label: 'Assert sidebar layout',
      action: 'assert_style',
      assert_style: {
        selector: 'aside, [role="navigation"]',
        expected_styles: { 'position': 'fixed|sticky' },
      },
    });

    steps.push({
      step_id: nextStepId(),
      label: 'Assert main content not clipped',
      action: 'assert_style',
      assert_style: {
        selector: 'main, [role="main"]',
        expected_styles: { 'overflow': 'visible|auto|scroll' },
      },
    });
  }

  // Card grid responsive check — grids should have gap
  if (analysis.pages.some(p => p.children.some(c => c.kind === 'element' && c.element === 'grid'))) {
    steps.push({
      step_id: nextStepId(),
      label: 'Assert card grid spacing',
      action: 'assert_style',
      assert_style: {
        selector: '.grid, [class*="grid-cols"]',
        expected_styles: { 'display': 'grid' },
      },
    });
  }

  // Final: console error check
  steps.push({
    step_id: nextStepId(),
    label: 'Check for console errors',
    action: 'check_console',
    expected: { no_errors: true },
  });

  return {
    flow_id: `auto-${ctx.appName}`,
    description: `Auto-generated QA flow for ${ctx.appName}`,
    base_url_client: baseUrlClient,
    base_url_server: baseUrlServer,
    preflight_health_path: preflightPath,
    steps,
  };
}

// ---- Page Interaction Steps ----

function generatePageInteractionSteps(
  page: PageInfo,
  ctx: TranspileContext,
  analysis: UIAnalysis,
  steps: FlowStep[],
  nextStepId: () => string,
): void {
  // Walk page children for buttons with actions and forms
  walkForInteractions(page.children, page.name, ctx, analysis, steps, nextStepId);
}

function walkForInteractions(
  nodes: AirUINode[],
  pageName: string,
  ctx: TranspileContext,
  analysis: UIAnalysis,
  steps: FlowStep[],
  nextStepId: () => string,
): void {
  for (const node of nodes) {
    // Button with mutation action (! operator)
    if (node.kind === 'unary' && node.operator === '!') {
      const actionName = extractMutationNameFromNode(node.operand);
      if (actionName) {
        const selector = `[data-air-cta="${actionName}"], button:has-text('${actionName}')`;
        steps.push({
          step_id: nextStepId(),
          label: `Click CTA: ${actionName} (${pageName})`,
          action: 'click',
          selector,
          dead_cta_check: true,
          expected: { dom_mutation: true },
        });
      }
    }

    // Form elements → type + submit
    if (node.kind === 'element' && node.element === 'form') {
      const formCtx = pageName.toLowerCase();
      const formSelector = `[data-air-form="${formCtx}"], form`;

      // Type into visible inputs
      if (node.children) {
        for (const child of node.children) {
          const resolved = resolveBindChain(child);
          if (resolved && isInputElement(resolved.element)) {
            const inputType = resolved.modifiers[0] || 'text';
            const value = getTestValue(inputType);
            steps.push({
              step_id: nextStepId(),
              label: `Type in ${resolved.element} (${pageName})`,
              action: 'type',
              selector: `${formSelector} input[type="${inputType}"], ${formSelector} input`,
              value,
            });
          }
        }
      }

      // Submit the form
      steps.push({
        step_id: nextStepId(),
        label: `Submit form (${pageName})`,
        action: 'click',
        selector: `${formSelector} button[type="submit"], ${formSelector} button`,
        dead_cta_check: true,
        expected: { dom_mutation: true, network_request: ctx.hasBackend },
      });
    }

    // Bind chains with actions (btn:primary:!action)
    if (node.kind === 'binary' && node.operator === ':') {
      const resolved = resolveBindChain(node);
      if (resolved && resolved.action) {
        const actionName = extractMutationNameFromNode(resolved.action.kind === 'unary' ? resolved.action.operand : resolved.action);
        if (actionName && (resolved.element === 'btn' || resolved.element === 'button')) {
          const selector = `[data-air-cta="${actionName}"], button:has-text('${resolved.label || actionName}')`;
          steps.push({
            step_id: nextStepId(),
            label: `Click CTA: ${actionName} (${pageName})`,
            action: 'click',
            selector,
            dead_cta_check: true,
            expected: { dom_mutation: true },
          });
        }
      }
    }

    // Flow chains (element > "Label" patterns with buttons)
    if (node.kind === 'binary' && node.operator === '>') {
      const leftResolved = tryResolveElementName(node.left);
      if (leftResolved && (leftResolved === 'btn' || leftResolved === 'button' || leftResolved === 'link')) {
        const label = node.right.kind === 'text' ? node.right.text : leftResolved;
        steps.push({
          step_id: nextStepId(),
          label: `Click: ${label} (${pageName})`,
          action: 'click',
          selector: `button:has-text('${label}'), a:has-text('${label}')`,
          dead_cta_check: true,
          expected: { dom_mutation: true },
        });
      }
    }

    // Recurse into children
    if (node.kind === 'element' && node.children) {
      walkForInteractions(node.children, pageName, ctx, analysis, steps, nextStepId);
    }
    if (node.kind === 'scoped') {
      walkForInteractions(node.children, pageName, ctx, analysis, steps, nextStepId);
    }
    if (node.kind === 'binary') {
      walkForInteractions([node.left, node.right], pageName, ctx, analysis, steps, nextStepId);
    }
    if (node.kind === 'unary') {
      walkForInteractions([node.operand], pageName, ctx, analysis, steps, nextStepId);
    }
  }
}

// ---- Helpers ----

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractMutationNameFromNode(node: AirUINode): string | null {
  if (node.kind === 'element') return node.element;
  if (node.kind === 'binary' && node.operator === '.') {
    const left = node.left.kind === 'element' ? node.left.element : null;
    const right = node.right.kind === 'element' ? node.right.element : null;
    if (left && right) return `${left}.${right}`;
  }
  return null;
}

function tryResolveElementName(node: AirUINode): string | null {
  if (node.kind === 'element') return node.element;
  if (node.kind === 'binary' && node.operator === ':') {
    const resolved = resolveBindChain(node);
    if (resolved) return resolved.element;
  }
  return null;
}

function isInputElement(element: string): boolean {
  return ['input', 'textarea', 'select'].includes(element);
}

function getTestValue(inputType: string): string {
  switch (inputType) {
    case 'email': return 'test@example.com';
    case 'password': return 'TestPass123!';
    case 'number': return '42';
    case 'tel': return '+1234567890';
    case 'url': return 'https://example.com';
    case 'date': return '2024-01-15';
    case 'search': return 'test search';
    default: return 'Test value';
  }
}
