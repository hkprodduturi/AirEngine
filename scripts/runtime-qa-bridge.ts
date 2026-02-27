#!/usr/bin/env npx tsx
/**
 * Runtime QA → Incident Bridge (SH8)
 *
 * Maps QA step failures to structured SH1 incidents with explicit tags.
 * Dead CTAs, navigation failures, and console errors each get specific
 * incident templates with rich evidence from the QA runner.
 *
 * Usage: Called programmatically by self-heal-loop.ts, not directly via CLI.
 */

import { join } from 'path';
import {
  buildIncident,
  writeIncidentArtifact,
  type CaptureArgs,
  type Incident,
  type EvidenceItem,
} from './capture-incident.js';
import { classifyIncident, applyTriage } from './classify-incident.js';
import type {
  FlowSpec,
  StepResult,
  RuntimeQAResult,
} from './runtime-qa-run.js';

// ---- Types ----

export interface BridgedIncident {
  incident_id: string;
  incident_path: string;
  classification: string | null;
  severity: string;
  step_id: string;
  label: string;
}

export interface BridgeOptions {
  /** Skip writing artifacts (for testing) */
  dryRun?: boolean;
  /** Skip triage classification (for testing) */
  skipTriage?: boolean;
}

// ---- Evidence Builder (guardrail 5) ----

export function buildRichEvidence(step: StepResult): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];

  // Console errors
  for (const err of step.evidence.console_errors) {
    evidence.push({
      kind: 'console_line',
      content: err,
      file_path: null,
      line_number: null,
      label: 'Console error during QA step',
    });
  }

  // DOM snapshot
  if (step.evidence.dom_snippet) {
    evidence.push({
      kind: 'dom_snapshot_path',
      content: step.evidence.dom_snippet,
      file_path: null,
      line_number: null,
      label: `DOM snippet for ${step.evidence.selector || step.label}`,
    });
  }

  // Screenshot
  if (step.evidence.screenshot_path) {
    evidence.push({
      kind: 'screenshot_path',
      content: step.evidence.screenshot_path,
      file_path: step.evidence.screenshot_path,
      line_number: null,
      label: `Screenshot after ${step.label}`,
    });
  }

  // URL transition
  if (step.evidence.url_before || step.evidence.url_after) {
    evidence.push({
      kind: 'raw_output',
      content: `url_before: ${step.evidence.url_before || 'N/A'}\nurl_after: ${step.evidence.url_after || 'N/A'}\ndom_changed: ${step.evidence.dom_changed}`,
      file_path: null,
      line_number: null,
      label: 'URL transition and DOM change',
    });
  }

  // Network requests
  if (step.evidence.network_requests.length > 0) {
    evidence.push({
      kind: 'request_response',
      content: step.evidence.network_requests.join('\n'),
      file_path: null,
      line_number: null,
      label: 'Network requests during step',
    });
  }

  // SH9: Computed styles from assert_style
  if (step.evidence.computed_styles) {
    evidence.push({
      kind: 'computed_style',
      content: JSON.stringify(step.evidence.computed_styles, null, 2),
      file_path: null,
      line_number: null,
      label: 'Computed styles for style assertion',
    });
  }

  // SH9: Visual diff evidence
  if (step.evidence.visual_screenshot_path) {
    evidence.push({
      kind: 'visual_diff',
      content: `screenshot: ${step.evidence.visual_screenshot_path}\ndiff_score: ${step.evidence.visual_diff_score ?? 'N/A'}`,
      file_path: step.evidence.visual_screenshot_path,
      line_number: null,
      label: 'Visual snapshot comparison',
    });
  }

  return evidence;
}

// ---- Step → Incident Mapping ----

function extractPageName(step: StepResult, spec: FlowSpec): string {
  // Extract page name from label or flow_id
  const label = step.label.toLowerCase();
  if (label.includes('home')) return 'HomePage';
  if (label.includes('gallery')) return 'GalleryPage';
  if (label.includes('contact')) return 'ContactPage';
  if (label.includes('book')) return 'BookingPage';
  if (label.includes('portfolio')) return 'PortfolioPage';
  // Fallback: use flow_id
  return spec.flow_id;
}

export function stepToIncidentArgs(
  step: StepResult,
  flowSpec: FlowSpec,
  _qaResult: RuntimeQAResult,
): CaptureArgs {
  const pageName = extractPageName(step, flowSpec);

  // Base args common to all failure types
  const baseArgs: CaptureArgs = {
    source: 'runtime-qa',
    stage: 'runtime-ui',
    summary: '',
    message: step.failure_reason || `Step "${step.label}" failed`,
    severity: 'p1',
    pageName,
    screenshots: [],
    tags: ['runtime-qa', flowSpec.flow_id, step.label],
  };

  if (step.evidence.screenshot_path) {
    baseArgs.screenshots.push(step.evidence.screenshot_path);
  }

  // Dead CTA (guardrail 7)
  if (step.dead_cta_detected) {
    baseArgs.summary = `Dead CTA: "${step.label}" — click produced no effect`;
    baseArgs.message = `Button "${step.evidence.text_content || step.evidence.selector || step.label}" has no onClick handler or navigation effect. URL unchanged (${step.evidence.url_before}), DOM unchanged.`;
    baseArgs.severity = step.severity || 'p1';
    baseArgs.tags.push('dead-cta', pageName);
    return baseArgs;
  }

  // Console error
  if (step.action === 'check_console' && step.evidence.console_errors.length > 0) {
    baseArgs.summary = `Console errors detected during ${flowSpec.flow_id} flow`;
    baseArgs.message = step.evidence.console_errors.join('; ');
    baseArgs.severity = 'p2';
    baseArgs.tags.push('console-error', pageName);
    return baseArgs;
  }

  // Navigation failure
  if (step.action === 'navigate' && step.status === 'fail') {
    baseArgs.summary = `Navigation failure: "${step.label}" did not reach expected state`;
    baseArgs.message = step.failure_reason || 'Navigation did not produce expected visible element';
    baseArgs.severity = 'p1';
    baseArgs.tags.push('navigation-failure', pageName);
    return baseArgs;
  }

  // Generic click failure (not dead CTA)
  if (step.action === 'click' && step.status === 'fail') {
    baseArgs.summary = `Click failure: "${step.label}" — ${step.failure_reason || 'unknown'}`;
    baseArgs.tags.push('click-failure', pageName);
    return baseArgs;
  }

  // Generic failure
  baseArgs.summary = `QA step failed: "${step.label}" — ${step.failure_reason || 'unknown'}`;
  baseArgs.tags.push(pageName);
  return baseArgs;
}

// ---- Bridge Runner ----

export function bridgeFailedSteps(
  qaResult: RuntimeQAResult,
  flowSpec: FlowSpec,
  options: BridgeOptions = {},
): BridgedIncident[] {
  const bridged: BridgedIncident[] = [];

  for (const step of qaResult.steps) {
    if (step.status !== 'fail') continue;

    // Map step failure to capture args
    const args = stepToIncidentArgs(step, flowSpec, qaResult);

    // Build incident
    const incident = buildIncident(args);

    // Inject rich evidence (guardrail 5)
    const richEvidence = buildRichEvidence(step);
    incident.evidence.push(...richEvidence);

    if (options.dryRun) {
      bridged.push({
        incident_id: incident.incident_id,
        incident_path: '<dry-run>',
        classification: null,
        severity: incident.severity,
        step_id: step.step_id,
        label: step.label,
      });
      continue;
    }

    // Write incident artifact
    const incidentPath = writeIncidentArtifact(incident);

    // Classify (SH1 triage)
    let classification: string | null = null;
    if (!options.skipTriage) {
      try {
        const { triage } = applyTriage(incidentPath);
        classification = triage.classification;
      } catch {
        // Classification failure should not block bridge
      }
    }

    bridged.push({
      incident_id: incident.incident_id,
      incident_path: incidentPath,
      classification,
      severity: incident.severity,
      step_id: step.step_id,
      label: step.label,
    });
  }

  return bridged;
}

// ---- Exports ----

export { type FlowSpec, type StepResult, type RuntimeQAResult } from './runtime-qa-run.js';
