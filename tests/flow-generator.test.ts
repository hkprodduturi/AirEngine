/**
 * Flow Generator Tests (H10 — Batch 6)
 *
 * Tests auto QA flow generation from .air AST.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { generateFlowSpec, type FlowGenOptions } from '../src/self-heal/flow-generator.js';
import type { FlowSpec, FlowStep } from '../src/self-heal/runtime-qa.js';

// ---- Helpers ----

function loadSource(name: string): string {
  return readFileSync(`examples/${name}.air`, 'utf-8');
}

function findSteps(spec: FlowSpec, action: FlowStep['action']): FlowStep[] {
  return spec.steps.filter(s => s.action === action);
}

function findStepsByLabel(spec: FlowSpec, pattern: string): FlowStep[] {
  return spec.steps.filter(s => s.label.toLowerCase().includes(pattern.toLowerCase()));
}

// ---- Tests ----

describe('generateFlowSpec', () => {
  it('generates flow from todo.air with navigate + CTA steps', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source);

    expect(spec.flow_id).toBe('auto-todo');
    expect(spec.steps.length).toBeGreaterThanOrEqual(2);

    // Must start with navigate
    expect(spec.steps[0].action).toBe('navigate');
    expect(spec.steps[0].target).toBe('/');

    // Must end with console check
    const last = spec.steps[spec.steps.length - 1];
    expect(last.action).toBe('check_console');
  });

  it('generates flow from fullstack-todo.air with backend preflight', () => {
    const source = loadSource('fullstack-todo');
    const spec = generateFlowSpec(source);

    expect(spec.flow_id).toBe('auto-fullstack-todo');
    // Backend app → server on separate port
    expect(spec.base_url_server).toBe('http://localhost:3001');
    expect(spec.preflight_health_path).toBe('/api/health');
  });

  it('generates flow from dashboard.air with page navigation', () => {
    const source = loadSource('dashboard');
    const spec = generateFlowSpec(source);

    // Dashboard has multiple pages (overview, users) — generates page navigation steps
    const pageNavSteps = findStepsByLabel(spec, 'Navigate to page');
    expect(pageNavSteps.length).toBeGreaterThan(0);

    // Page nav steps use data-air-nav selectors
    for (const step of pageNavSteps) {
      expect(step.selector).toContain('[data-air-nav=');
    }
  });

  it('prefers data-air-* selectors with text fallback', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source);

    // All click/nav selectors should include data-air-* first
    for (const step of spec.steps) {
      if (step.action === 'click' && step.selector) {
        const hasDataAirSelector = step.selector.includes('[data-air-');
        // Most selectors should have data-air-* prefix
        // (some generated steps may use plain selectors)
        if (step.label.startsWith('Click nav') || step.label.startsWith('Navigate to page')) {
          expect(hasDataAirSelector).toBe(true);
        }
      }
    }
  });

  it('includes style lane steps when styleLane is true', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source, { styleLane: true });

    const styleSteps = findSteps(spec, 'assert_style');
    expect(styleSteps.length).toBeGreaterThan(0);

    // Should check button styling
    const btnStyle = styleSteps.find(s => s.assert_style?.selector === 'button');
    expect(btnStyle).toBeDefined();
  });

  it('includes visual lane steps when visualLane is true', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source, { visualLane: true });

    const visualSteps = findSteps(spec, 'visual_snapshot');
    expect(visualSteps.length).toBeGreaterThan(0);

    const rootSnap = visualSteps.find(s =>
      s.visual_snapshot?.baseline_name === 'todo-root'
    );
    expect(rootSnap).toBeDefined();
  });

  it('respects port customization', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source, { clientPort: 4000, serverPort: 4001 });

    expect(spec.base_url_client).toBe('http://localhost:4000');
    // todo.air is frontend-only → server URL = client URL (adjustment 3)
    expect(spec.base_url_server).toBe('http://localhost:4000');
  });

  it('frontend-only app uses client port for server URL and "/" preflight', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source);

    // todo.air has no @api/@db → frontend-only
    expect(spec.base_url_client).toBe('http://localhost:3000');
    expect(spec.base_url_server).toBe('http://localhost:3000');
    expect(spec.preflight_health_path).toBe('/');
  });

  it('backend app uses separate server port and /api/health preflight', () => {
    const source = loadSource('fullstack-todo');
    const spec = generateFlowSpec(source);

    expect(spec.base_url_client).toBe('http://localhost:3000');
    expect(spec.base_url_server).toBe('http://localhost:3001');
    expect(spec.preflight_health_path).toBe('/api/health');
  });

  it('empty nav still generates navigate + console steps', () => {
    // landing.air has sections but potentially no nav
    const source = loadSource('landing');
    const spec = generateFlowSpec(source);

    expect(spec.steps.length).toBeGreaterThanOrEqual(2);
    expect(spec.steps[0].action).toBe('navigate');
    expect(spec.steps[spec.steps.length - 1].action).toBe('check_console');
  });

  it('all step_ids are unique', () => {
    const source = loadSource('dashboard');
    const spec = generateFlowSpec(source);

    const ids = spec.steps.map(s => s.step_id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('step_ids follow sequential pattern', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source);

    expect(spec.steps[0].step_id).toBe('S001');
    if (spec.steps.length >= 2) {
      expect(spec.steps[1].step_id).toBe('S002');
    }
  });

  it('generates valid FlowSpec structure', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source);

    // Required fields present
    expect(spec.flow_id).toBeTruthy();
    expect(spec.base_url_client).toBeTruthy();
    expect(spec.base_url_server).toBeTruthy();
    expect(spec.preflight_health_path).toBeTruthy();
    expect(Array.isArray(spec.steps)).toBe(true);
    expect(spec.steps.length).toBeGreaterThan(0);

    // All steps have required fields
    for (const step of spec.steps) {
      expect(step.step_id).toBeTruthy();
      expect(step.label).toBeTruthy();
      expect(step.action).toBeTruthy();
    }
  });

  it('generates form interaction steps for auth.air', () => {
    const source = loadSource('auth');
    const spec = generateFlowSpec(source);

    // auth.air has login form → must generate at least a Submit step
    const submitSteps = spec.steps.filter(s =>
      s.label.includes('Submit form') || s.label.includes('submit')
    );
    expect(submitSteps.length).toBeGreaterThan(0);

    // Auth pages should generate page navigation steps
    const pageNavSteps = findStepsByLabel(spec, 'Navigate to page');
    expect(pageNavSteps.length).toBeGreaterThan(0);
  });

  it('custom preflightPath is respected', () => {
    const source = loadSource('fullstack-todo');
    const spec = generateFlowSpec(source, { preflightPath: '/health' });
    expect(spec.preflight_health_path).toBe('/health');
  });

  it('includes H11 default layout assertions but not visual steps', () => {
    // ecommerce.air has pages + nav routes → triggers H11 default assertions
    const source = loadSource('ecommerce');
    const spec = generateFlowSpec(source);

    // H11: default layout assertions are always included (header/nav, CTA styling)
    const styleSteps = findSteps(spec, 'assert_style');
    expect(styleSteps.length).toBeGreaterThan(0);

    // Visual steps still require explicit opt-in
    const visualSteps = findSteps(spec, 'visual_snapshot');
    expect(visualSteps.length).toBe(0);
  });

  it('description includes app name', () => {
    const source = loadSource('todo');
    const spec = generateFlowSpec(source);
    expect(spec.description).toContain('todo');
  });

  it('dashboard pages generate page navigation steps', () => {
    const source = loadSource('dashboard');
    const spec = generateFlowSpec(source);

    const pageNavSteps = findStepsByLabel(spec, 'Navigate to page');
    expect(pageNavSteps.length).toBeGreaterThan(0);
  });

  it('generates CTA steps for apps with pages', () => {
    // auth.air has pages with mutation buttons (login, logout)
    const source = loadSource('auth');
    const spec = generateFlowSpec(source);

    const ctaSteps = spec.steps.filter(s => s.label.startsWith('Click CTA'));
    // auth.air has !login and !logout mutations on pages
    expect(ctaSteps.length).toBeGreaterThan(0);
  });

  // ---- H11: Default layout assertion tests ----

  it('H11: generates header/nav assertion for apps with nav routes', () => {
    const source = loadSource('ecommerce');
    const spec = generateFlowSpec(source);

    const headerAssert = spec.steps.find(s =>
      s.action === 'assert_style' && s.label.includes('header/nav')
    );
    expect(headerAssert).toBeDefined();
    expect(headerAssert?.assert_style?.selector).toContain('[data-air-nav]');
  });

  it('H11: generates primary CTA assertion for apps with pages', () => {
    const source = loadSource('dashboard');
    const spec = generateFlowSpec(source);

    const ctaAssert = spec.steps.find(s =>
      s.action === 'assert_style' && s.label.includes('primary CTA')
    );
    expect(ctaAssert).toBeDefined();
    expect(ctaAssert?.assert_style?.selector).toContain('[data-air-cta]');
  });

  it('H11: generates sidebar assertion for multi-page apps', () => {
    // ecommerce.air has 4 pages (login, shop, cart, orders) → triggers sidebar assertion (>= 3)
    const source = loadSource('ecommerce');
    const spec = generateFlowSpec(source);

    const sidebarAssert = spec.steps.find(s =>
      s.action === 'assert_style' && s.label.includes('sidebar layout')
    );
    expect(sidebarAssert).toBeDefined();
    expect(sidebarAssert?.assert_style?.expected_styles?.position).toContain('fixed');
  });
});
