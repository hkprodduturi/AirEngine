/**
 * Dev Heal Loop Core (H11 — Multi-Lane Architecture)
 *
 * Self-contained heal loop for `air dev --self-heal` integration.
 * Lives in src/ so it compiles to dist/. No imports from scripts/.
 *
 * H11 upgrade: outcome-first healing with three lanes:
 *   1) Runtime/Env Remediation — deps, DB, ports, auth
 *   2) Transpiler Patch — SH9 codegen trace pipeline
 *   3) UI/Layout Remediation — style, alignment, typography, z-index
 *
 * Flow: QA → classify → runtime remediation → QA re-run →
 *       transpiler patches → QA re-run → UI remediation
 *
 * Only patches framework-owned source (guarded by isAllowedSelfHealPatchTarget).
 * Never patches generated output.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import type { FlowSpec, RuntimeQAResult, QARunOptions, QAExecutor, VisualBaselineMode } from './runtime-qa.js';
import { traceToTranspiler, runAllTraces, type CodegenTraceEntry, type CodegenTraceResult } from './codegen-trace.js';
import {
  proposeTranspilerPatch, verifyTranspilerPatch, isAllowedSelfHealPatchTarget,
  normalizePatchPath, type TranspilerPatchResult, type PatchVerification,
} from './transpiler-patch.js';
import { runInvariants } from './invariants.js';
import {
  classifyRuntimeIssues, runRemediation, hasRuntimeIssues,
  type RemediationReport, type RuntimeIssue, type RemediationContext,
} from './runtime-remediator.js';
import {
  classifyUIIssues, runUIRemediation, hasUIIssues,
  type UIRemediationReport, type UIIssue, type UIRemediationResult,
} from './ui-layout-remediator.js';

// ---- Types ----

export type HealMode = 'off' | 'shadow' | 'propose' | 'transpiler-patch';

export interface DevHealOptions {
  /** The flow spec to execute (generated or loaded) */
  flowSpec: FlowSpec;
  /** Self-heal mode */
  mode: HealMode;
  /** Directory containing transpiled output */
  outputDir: string;
  /** Path to the .air source file */
  airFilePath?: string;
  /** QA executor (Playwright-backed or mock) */
  executeFlow: QAExecutor;
  /** Only apply verified patches to allowed targets */
  healApply?: 'none' | 'verified';
  /** Visual baseline mode: first cycle records, subsequent compare */
  baselineMode?: VisualBaselineMode;
  /** Headless browser mode */
  headless?: boolean;
  /** Max verify attempts per patch */
  maxAttempts?: number;
  /** Re-transpile function for testing (overrides child process) */
  mockRetranspile?: (worktreePath: string) => Map<string, string> | null;
  /** Whether the app has a backend (for runtime remediation context) */
  hasBackend?: boolean;
  /** Client port (for runtime remediation context) */
  clientPort?: number;
  /** Server port (for runtime remediation context) */
  serverPort?: number;
  /** Mock runtime remediation for tests */
  mockRemediation?: (issues: RuntimeIssue[], ctx: RemediationContext) => RemediationReport;
  /** Skip runtime remediation lane */
  skipRuntimeRemediation?: boolean;
  /** Skip UI remediation lane */
  skipUIRemediation?: boolean;
}

export interface TranspilerPatchRef {
  trace_id: string;
  transpiler_file: string;
  strategy: string;
  verdict: 'pass' | 'fail' | 'skipped';
  diff_summary?: string;
}

export interface HealLaneResult {
  lane: 'runtime' | 'transpiler' | 'ui';
  ran: boolean;
  details: string;
}

export interface DevHealResult {
  /** QA run verdict */
  qaVerdict: 'pass' | 'fail';
  /** Number of steps */
  totalSteps: number;
  /** Dead CTAs found */
  deadCtas: number;
  /** Failed steps */
  failedSteps: number;
  /** Classifications extracted from failed steps */
  classifications: string[];
  /** Transpiler patches proposed */
  transpilerPatches: TranspilerPatchRef[];
  /** Patches that were promoted (applied) to framework source */
  promotedFiles: string[];
  /** Overall verdict */
  verdict: 'pass' | 'fail' | 'partial';
  /** Duration in ms */
  durationMs: number;
  /** H11: Runtime remediation report (if lane ran) */
  runtimeRemediation?: RemediationReport;
  /** H11: UI remediation report (if lane ran) */
  uiRemediation?: UIRemediationReport;
  /** H11: Which lanes ran and what they did */
  lanes: HealLaneResult[];
}

// ---- Simplified Bridge (inline, no dependency on scripts/runtime-qa-bridge.ts) ----

/** Classification heuristic: map QA failure patterns to codegen trace IDs */
function classifyFailedStep(step: { label: string; action: string; failure_reason: string | null; dead_cta_detected: boolean }): string | null {
  const reason = (step.failure_reason || '').toLowerCase();

  // Style mismatch → CSS specificity
  if (step.action === 'assert_style' && reason.includes('style mismatch')) {
    return 'css-specificity-fight';
  }

  // Dead CTA → dead-cta (potential unreachable page or missing handler)
  if (step.dead_cta_detected) {
    return 'dead-cta';
  }

  // Element not visible → could be missing page or routing issue
  if (reason.includes('not visible') || reason.includes('not found')) {
    return 'element-not-found';
  }

  // Console errors → generic runtime error
  if (step.action === 'check_console' && reason.includes('console error')) {
    return 'console-errors';
  }

  return null;
}

// ---- Generated File Reader ----

function readGeneratedFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;

  function walk(current: string, relative: string): void {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(fullPath, relPath);
      } else if (/\.(jsx?|tsx?|css|html|json|prisma)$/.test(entry.name)) {
        try {
          files.set(relPath, readFileSync(fullPath, 'utf-8'));
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(dir, '');
  return files;
}

// ---- Patch & Retranspile (real verification path) ----

function patchAndRetranspile(
  patch: TranspilerPatchResult,
  airFilePath: string,
): Map<string, string> | null {
  const targetPath = join(process.cwd(), patch.transpiler_file);
  if (!existsSync(targetPath)) return null;

  const tempDir = join(tmpdir(), `air-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const originalContent = readFileSync(targetPath, 'utf-8');
  try {
    writeFileSync(targetPath, patch.patched_content, 'utf-8');
    mkdirSync(tempDir, { recursive: true });
    execSync(
      `npx tsx src/cli/index.ts transpile "${airFilePath}" -o "${tempDir}"`,
      { cwd: process.cwd(), encoding: 'utf-8', timeout: 30000, stdio: 'pipe' },
    );
    return readGeneratedFiles(tempDir);
  } catch {
    return null;
  } finally {
    writeFileSync(targetPath, originalContent, 'utf-8');
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ---- Promotion Guard (H10 adjustment 5) ----

const PROMOTION_BLOCKED_PREFIXES = [
  'output/', 'dist/', 'artifacts/', 'demo-output/',
  '.air-artifacts/', 'test-output/', 'node_modules/',
  'test-output-auth/', 'test-output-dashboard/',
  'test-output-expense/', 'test-output-landing/',
];

export function isPromotionAllowed(targetFile: string): boolean {
  const normalized = normalizePatchPath(targetFile.trim());
  if (!normalized) return false;
  if (PROMOTION_BLOCKED_PREFIXES.some(p => normalized.startsWith(p))) return false;
  return isAllowedSelfHealPatchTarget(normalized);
}

// ---- Core Heal Loop (H11 Multi-Lane) ----

export async function runDevHealLoop(options: DevHealOptions): Promise<DevHealResult> {
  const start = performance.now();
  const mode = options.mode;
  const headless = options.headless ?? true;
  const healApply = options.healApply ?? 'none';
  const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts ?? 1));
  const lanes: HealLaneResult[] = [];

  // ---- Phase 1: Initial QA Run ----
  let qaResult = await options.executeFlow(options.flowSpec, {
    headless,
    flowPath: '<auto-generated>',
    baselineMode: options.baselineMode,
  });

  let deadCtas = qaResult.steps.filter(s => s.dead_cta_detected).length;
  let failedSteps = qaResult.steps.filter(s => s.status === 'fail').length;

  // If QA passes, no healing needed
  if (qaResult.verdict === 'pass') {
    return {
      qaVerdict: 'pass',
      totalSteps: qaResult.steps.length,
      deadCtas,
      failedSteps: 0,
      classifications: [],
      transpilerPatches: [],
      promotedFiles: [],
      verdict: 'pass',
      durationMs: Math.round(performance.now() - start),
      lanes,
    };
  }

  // Shadow mode: report only, no healing actions
  if (mode === 'shadow') {
    const classifications = qaResult.steps
      .filter(s => s.status === 'fail')
      .map(s => classifyFailedStep(s))
      .filter((c): c is string => c !== null);

    return {
      qaVerdict: 'fail',
      totalSteps: qaResult.steps.length,
      deadCtas,
      failedSteps,
      classifications,
      transpilerPatches: [],
      promotedFiles: [],
      verdict: 'fail',
      durationMs: Math.round(performance.now() - start),
      lanes,
    };
  }

  // ---- Phase 2: Classify Failed Steps ----
  const classifications: string[] = [];
  for (const step of qaResult.steps) {
    if (step.status !== 'fail') continue;
    const cls = classifyFailedStep(step);
    if (cls && !classifications.includes(cls)) {
      classifications.push(cls);
    }
  }

  // ---- Phase 3: Runtime/Env Remediation Lane (H11) ----
  let runtimeReport: RemediationReport | undefined;
  if (!options.skipRuntimeRemediation && mode === 'transpiler-patch' && hasRuntimeIssues(qaResult)) {
    const hasBackend = options.hasBackend ?? existsSync(join(options.outputDir, 'server'));
    const remCtx: RemediationContext = {
      outputDir: options.outputDir,
      clientPort: options.clientPort ?? 3000,
      serverPort: options.serverPort ?? 3001,
      hasBackend,
    };

    const runtimeIssues = classifyRuntimeIssues(qaResult, options.outputDir, hasBackend);

    if (runtimeIssues.length > 0) {
      if (options.mockRemediation) {
        runtimeReport = options.mockRemediation(runtimeIssues, remCtx);
      } else {
        runtimeReport = runRemediation(runtimeIssues, remCtx);
      }

      lanes.push({
        lane: 'runtime',
        ran: true,
        details: `${runtimeReport.issuesFixed} fixed, ${runtimeReport.issuesPending} pending (${runtimeReport.issues.map(i => i.kind).join(', ')})`,
      });

      // If runtime remediation fixed something, re-run QA to see improvement
      if (runtimeReport.issuesFixed > 0) {
        const rerunResult = await options.executeFlow(options.flowSpec, {
          headless,
          flowPath: '<auto-generated>',
          baselineMode: options.baselineMode,
        });

        // If QA now passes, return early with success
        if (rerunResult.verdict === 'pass') {
          return {
            qaVerdict: 'pass',
            totalSteps: rerunResult.steps.length,
            deadCtas: 0,
            failedSteps: 0,
            classifications,
            transpilerPatches: [],
            promotedFiles: [],
            verdict: 'pass',
            durationMs: Math.round(performance.now() - start),
            runtimeRemediation: runtimeReport,
            lanes,
          };
        }

        // Update counts from re-run
        qaResult = rerunResult;
        deadCtas = qaResult.steps.filter(s => s.dead_cta_detected).length;
        failedSteps = qaResult.steps.filter(s => s.status === 'fail').length;
      }
    } else {
      lanes.push({ lane: 'runtime', ran: false, details: 'No runtime issues classified' });
    }
  } else {
    lanes.push({ lane: 'runtime', ran: false, details: options.skipRuntimeRemediation ? 'Skipped' : 'Not applicable' });
  }

  // ---- Phase 4: Transpiler Patch Lane (existing SH9/H10) ----
  const generatedFiles = readGeneratedFiles(options.outputDir);
  const transpilerPatchRefs: TranspilerPatchRef[] = [];
  const pendingPatches: TranspilerPatchResult[] = [];
  const patchedFiles = new Set<string>();

  for (const classification of classifications) {
    const traceResult = traceToTranspiler(classification, generatedFiles);
    if (!traceResult) continue;

    const { trace, result: detection } = traceResult;
    const targetFile = normalizePatchPath(trace.fix.target_file);
    if (patchedFiles.has(targetFile)) continue;

    const patchResult = proposeTranspilerPatch(trace, detection);
    if (!patchResult) continue;

    patchedFiles.add(targetFile);
    pendingPatches.push(patchResult);
    transpilerPatchRefs.push({
      trace_id: trace.id,
      transpiler_file: patchResult.transpiler_file,
      strategy: patchResult.strategy,
      verdict: 'skipped',
      diff_summary: patchResult.diff_summary,
    });
  }

  // Propose mode: report patches but don't verify/apply
  if (mode === 'propose') {
    lanes.push({ lane: 'transpiler', ran: true, details: `${transpilerPatchRefs.length} patches proposed` });
    return {
      qaVerdict: 'fail',
      totalSteps: qaResult.steps.length,
      deadCtas,
      failedSteps,
      classifications,
      transpilerPatches: transpilerPatchRefs,
      promotedFiles: [],
      verdict: transpilerPatchRefs.length > 0 ? 'partial' : 'fail',
      durationMs: Math.round(performance.now() - start),
      runtimeRemediation: runtimeReport,
      lanes,
    };
  }

  // Transpiler-patch mode — verify patches
  if (mode === 'transpiler-patch') {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const hasPending = transpilerPatchRefs.some(ref => ref.verdict !== 'pass');
      if (!hasPending) break;

      for (let i = 0; i < pendingPatches.length; i++) {
        const ref = transpilerPatchRefs[i];
        if (ref.verdict === 'pass') continue;

        const patch = pendingPatches[i];

        let outputFilesAfter: Map<string, string> | null = null;
        if (options.mockRetranspile) {
          outputFilesAfter = options.mockRetranspile(process.cwd());
        } else if (options.airFilePath) {
          outputFilesAfter = patchAndRetranspile(patch, options.airFilePath);
        }

        const verification = verifyTranspilerPatch(
          patch, generatedFiles, outputFilesAfter, runInvariants,
        );
        patch.verification = verification;

        if (verification.invariants_passed && verification.retranspile_successful && verification.style_checks_passed) {
          ref.verdict = 'pass';
        } else {
          ref.verdict = 'fail';
        }
      }
    }
  }

  // Promotion — apply verified patches
  const promotedFiles: string[] = [];
  if (healApply === 'verified' && mode === 'transpiler-patch') {
    for (let i = 0; i < pendingPatches.length; i++) {
      const ref = transpilerPatchRefs[i];
      if (ref.verdict !== 'pass') continue;

      const patch = pendingPatches[i];
      if (!isPromotionAllowed(patch.transpiler_file)) continue;

      const filePath = join(process.cwd(), patch.transpiler_file);
      if (!existsSync(filePath)) continue;

      writeFileSync(filePath, patch.patched_content, 'utf-8');
      promotedFiles.push(patch.transpiler_file);
    }
  }

  const transpilerPassed = transpilerPatchRefs.filter(p => p.verdict === 'pass').length;
  lanes.push({
    lane: 'transpiler',
    ran: transpilerPatchRefs.length > 0,
    details: transpilerPatchRefs.length > 0
      ? `${transpilerPassed}/${transpilerPatchRefs.length} verified, ${promotedFiles.length} promoted`
      : 'No codegen trace matches',
  });

  // ---- Phase 5: UI/Layout Remediation Lane (H11) ----
  let uiReport: UIRemediationReport | undefined;
  if (!options.skipUIRemediation && mode === 'transpiler-patch' && hasUIIssues(qaResult)) {
    const uiIssues = classifyUIIssues(qaResult);
    if (uiIssues.length > 0) {
      uiReport = runUIRemediation(uiIssues);
      lanes.push({
        lane: 'ui',
        ran: true,
        details: `${uiReport.patchesApplied} patches applied (${uiIssues.map(i => i.kind).join(', ')})`,
      });
    } else {
      lanes.push({ lane: 'ui', ran: false, details: 'No UI issues classified' });
    }
  } else {
    lanes.push({ lane: 'ui', ran: false, details: options.skipUIRemediation ? 'Skipped' : 'Not applicable' });
  }

  // ---- Compute Final Verdict ----
  const anyFixed = transpilerPassed > 0 ||
    (runtimeReport?.issuesFixed ?? 0) > 0 ||
    (uiReport?.patchesApplied ?? 0) > 0;

  let verdict: 'pass' | 'fail' | 'partial';
  if (failedSteps === 0) {
    verdict = 'pass';
  } else if (anyFixed) {
    verdict = 'partial';
  } else {
    verdict = 'fail';
  }

  return {
    qaVerdict: 'fail',
    totalSteps: qaResult.steps.length,
    deadCtas,
    failedSteps,
    classifications,
    transpilerPatches: transpilerPatchRefs,
    promotedFiles,
    verdict,
    durationMs: Math.round(performance.now() - start),
    runtimeRemediation: runtimeReport,
    uiRemediation: uiReport,
    lanes,
  };
}
