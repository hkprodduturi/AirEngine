/**
 * Runtime QA Core Types & Interfaces (H10 — Batch 0)
 *
 * Canonical type definitions for runtime QA flow specs and results.
 * Lives in src/ so it compiles to dist/ and can be imported by src/cli/dev.ts.
 *
 * scripts/runtime-qa-run.ts re-exports these types and provides the Playwright-based
 * execution implementation. src/self-heal/heal-loop.ts uses these types with
 * dependency injection for the actual browser executor.
 */

// ---- Flow Specification Types ----

export interface StepExpected {
  url_change?: boolean;
  dom_mutation?: boolean;
  network_request?: boolean;
  assert_visible?: string;
  no_errors?: boolean;
}

export interface AssertStyleFields {
  selector: string;
  expected_styles: Record<string, string>;
  viewport?: { width: number; height: number };
}

export interface VisualSnapshotFields {
  baseline_name: string;
  selector?: string;
  threshold?: number;
}

export interface FlowStep {
  step_id: string;
  label: string;
  action: 'navigate' | 'click' | 'type' | 'check_console' | 'assert_visible' | 'screenshot' | 'assert_style' | 'visual_snapshot';
  target?: string;
  selector?: string;
  value?: string;
  expected?: StepExpected;
  dead_cta_check?: boolean;
  severity?: string;
  assert_style?: AssertStyleFields;
  visual_snapshot?: VisualSnapshotFields;
}

export interface FlowSpec {
  flow_id: string;
  description?: string;
  base_url_client: string;
  base_url_server: string;
  preflight_health_path: string;
  setup?: string[];
  steps: FlowStep[];
}

// ---- Execution Result Types ----

export interface StepEvidence {
  selector: string | null;
  text_content: string | null;
  url_before: string | null;
  url_after: string | null;
  screenshot_path: string | null;
  console_errors: string[];
  network_requests: string[];
  dom_snippet: string | null;
  dom_changed: boolean;
  computed_styles?: Record<string, string>;
  visual_screenshot_path?: string;
  visual_diff_score?: number;
}

export interface StepResult {
  step_id: string;
  label: string;
  action: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  duration_ms: number;
  evidence: StepEvidence;
  failure_reason: string | null;
  dead_cta_detected: boolean;
  /** Optional: selector from corresponding FlowStep (for classifier use) */
  selector?: string;
  /** Optional: assert_style metadata from corresponding FlowStep */
  assert_style?: { selector: string; expected_styles: Record<string, string> };
  /** Optional: visual_snapshot metadata from corresponding FlowStep */
  visual_snapshot?: { baseline_name: string; threshold?: number };
}

export interface PreflightResult {
  health_check_url: string;
  status: 'pass' | 'fail' | 'skip';
  latency_ms: number;
  error: string | null;
}

export interface RunMetadata {
  headless: boolean;
  flow_path: string;
  dry_run?: boolean;
  timeout_ms?: number;
}

export interface RuntimeQASummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  dead_ctas: number;
  console_errors: number;
}

export interface RuntimeQAResult {
  schema_version: '1.0';
  qa_run_id: string;
  flow_id: string;
  timestamp: string;
  run_metadata: RunMetadata;
  preflight: PreflightResult;
  steps: StepResult[];
  summary: RuntimeQASummary;
  verdict: 'pass' | 'fail';
  incident_paths: string[];
}

export interface QARunOptions {
  headless?: boolean;
  dryRun?: boolean;
  timeoutMs?: number;
  flowPath?: string;
  baselineMode?: VisualBaselineMode;
  mockPage?: MockablePage;
  mockPreflight?: (spec: FlowSpec) => Promise<PreflightResult>;
}

export interface MockablePage {
  url(): string;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  fill?(selector: string, value: string): Promise<void>;
  waitForSelector?(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForEvent?(event: string, options?: Record<string, unknown>): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string): Promise<T>;
  screenshot?(options?: Record<string, unknown>): Promise<Buffer>;
  close?(): Promise<void>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeAllListeners?(event: string): void;
}

// ---- Visual Baseline Mode (H10 adjustment 7) ----

export type VisualBaselineMode = 'compare' | 'record-missing';

// ---- QA Executor Interface (dependency injection for heal loop) ----

/**
 * Function signature for executing a QA flow.
 * In production, this is backed by Playwright (scripts/runtime-qa-run.ts).
 * In tests, this is a mock.
 */
export type QAExecutor = (spec: FlowSpec, opts: QARunOptions) => Promise<RuntimeQAResult>;
