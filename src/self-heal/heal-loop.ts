/**
 * Dev Heal Loop Core (H11 — Multi-Lane Architecture)
 *
 * Self-contained heal loop for `air dev --self-heal` integration.
 * Lives in src/ so it compiles to dist/. No imports from scripts/.
 *
 * H11 upgrade: outcome-first healing with four lanes:
 *   1) Runtime/Env Remediation — deps, DB, ports, auth
 *   2) Parser Patch — PSH trace pipeline (H11 gap closure)
 *   3) Transpiler Patch — SH9 codegen trace pipeline
 *   4) UI/Layout Remediation — style, alignment, typography, z-index
 *
 * Flow: QA → classify → runtime remediation → QA re-run →
 *       parser patches → transpiler patches → UI patches →
 *       unified promotion → post-patch QA rerun
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
  traceToParser, parserTraceAsCodegenTrace, runAllParserTraces,
} from './parser-trace.js';
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
  /** Raw .air source (for parser trace detection) */
  airSource?: string;
  /** Parsed AST (for parser trace detection) */
  airAst?: any;
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
  verdict: 'pass' | 'fail' | 'skipped' | 'skipped-conflict';
  diff_summary?: string;
}

export interface HealLaneResult {
  lane: 'runtime' | 'parser' | 'transpiler' | 'ui';
  ran: boolean;
  details: string;
}

export interface PostPatchQARerun {
  ran: boolean;
  verdict: 'pass' | 'fail';
  improvementDelta: number;
  totalSteps: number;
  failedSteps: number;
  deadCtas: number;
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
  /** H11 gap closure: Post-patch QA rerun result */
  postPatchQARerun?: PostPatchQARerun;
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

  // ---- Phase 3.5: Parser Patch Lane (H11 gap closure) ----
  const generatedFiles = readGeneratedFiles(options.outputDir);
  const allPatchRefs: TranspilerPatchRef[] = [];
  const allPendingPatches: TranspilerPatchResult[] = [];
  const allPatchLanes: ('parser' | 'transpiler' | 'ui')[] = [];
  const patchedFiles = new Set<string>();

  if (options.airSource && options.airAst && mode === 'transpiler-patch') {
    let parserPatchCount = 0;

    // Run ALL parser traces directly against source/AST (not gated by classifications).
    // Parser traces detect source-vs-AST discrepancies independently of runtime failures.
    const parserDetections = runAllParserTraces(options.airSource, options.airAst);
    for (const { trace: pTrace, result: pDetection } of parserDetections) {
      const adapted = parserTraceAsCodegenTrace(pTrace, pDetection);
      const targetFile = normalizePatchPath(adapted.trace.fix.target_file);
      if (patchedFiles.has(targetFile)) continue;

      const patchResult = proposeTranspilerPatch(adapted.trace, adapted.result);
      if (!patchResult) continue;

      patchedFiles.add(targetFile);
      allPendingPatches.push(patchResult);
      allPatchLanes.push('parser');
      allPatchRefs.push({
        trace_id: adapted.trace.id,
        transpiler_file: patchResult.transpiler_file,
        strategy: patchResult.strategy,
        verdict: 'skipped',
        diff_summary: patchResult.diff_summary,
      });
      parserPatchCount++;
    }

    lanes.push({
      lane: 'parser',
      ran: parserPatchCount > 0,
      details: parserPatchCount > 0
        ? `${parserPatchCount} parser patch(es) proposed`
        : 'No parser trace matches',
    });
  } else {
    lanes.push({ lane: 'parser', ran: false, details: 'Not applicable' });
  }

  // ---- Phase 4: Transpiler Patch Lane (existing SH9/H10) ----
  for (const classification of classifications) {
    const traceResult = traceToTranspiler(classification, generatedFiles);
    if (!traceResult) continue;

    const { trace, result: detection } = traceResult;
    const targetFile = normalizePatchPath(trace.fix.target_file);
    if (patchedFiles.has(targetFile)) continue;

    const patchResult = proposeTranspilerPatch(trace, detection);
    if (!patchResult) continue;

    patchedFiles.add(targetFile);
    allPendingPatches.push(patchResult);
    allPatchLanes.push('transpiler');
    allPatchRefs.push({
      trace_id: trace.id,
      transpiler_file: patchResult.transpiler_file,
      strategy: patchResult.strategy,
      verdict: 'skipped',
      diff_summary: patchResult.diff_summary,
    });
  }

  // ---- Phase 4b: Static Audit — run all trace rules to catch issues not covered by QA classification ----
  // Some trace rules (e.g. SH9-006 handler-scaffold-only) detect patterns in generated output
  // that don't map to any QA step failure classification. runAllTraces covers them.
  const staticDetections = runAllTraces(generatedFiles);
  for (const { trace, result: detection } of staticDetections) {
    const targetFile = normalizePatchPath(trace.fix.target_file);
    if (patchedFiles.has(targetFile)) continue; // Already patched by classification pass

    const patchResult = proposeTranspilerPatch(trace, detection);
    if (!patchResult) continue;

    patchedFiles.add(targetFile);
    allPendingPatches.push(patchResult);
    allPatchLanes.push('transpiler');
    allPatchRefs.push({
      trace_id: trace.id,
      transpiler_file: patchResult.transpiler_file,
      strategy: patchResult.strategy,
      verdict: 'skipped',
      diff_summary: patchResult.diff_summary,
    });
  }

  // Propose mode: report patches but don't verify/apply
  if (mode === 'propose') {
    const transpilerRefs = allPatchRefs.filter((_, i) => allPatchLanes[i] === 'transpiler' || allPatchLanes[i] === 'parser');
    lanes.push({ lane: 'transpiler', ran: true, details: `${transpilerRefs.length} patches proposed` });
    lanes.push({ lane: 'ui', ran: false, details: 'Not applicable' });
    return {
      qaVerdict: 'fail',
      totalSteps: qaResult.steps.length,
      deadCtas,
      failedSteps,
      classifications,
      transpilerPatches: allPatchRefs,
      promotedFiles: [],
      verdict: allPatchRefs.length > 0 ? 'partial' : 'fail',
      durationMs: Math.round(performance.now() - start),
      runtimeRemediation: runtimeReport,
      lanes,
    };
  }

  // Transpiler-patch mode — verify all patches (parser + transpiler)
  if (mode === 'transpiler-patch') {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const hasPending = allPatchRefs.some(ref => ref.verdict !== 'pass');
      if (!hasPending) break;

      for (let i = 0; i < allPendingPatches.length; i++) {
        const ref = allPatchRefs[i];
        if (ref.verdict === 'pass') continue;

        const patch = allPendingPatches[i];

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

  const transpilerOnlyRefs = allPatchRefs.filter((_, i) => allPatchLanes[i] === 'transpiler');
  const transpilerPassed = transpilerOnlyRefs.filter(p => p.verdict === 'pass').length;
  lanes.push({
    lane: 'transpiler',
    ran: transpilerOnlyRefs.length > 0,
    details: transpilerOnlyRefs.length > 0
      ? `${transpilerPassed}/${transpilerOnlyRefs.length} verified`
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

  // ---- Phase 6: Unified Promotion + Post-Patch QA Rerun (H11 gap closure) ----
  // Promotion — apply verified patches in deterministic order (parser → transpiler → UI)
  const promotedFiles: string[] = [];
  const promotedPatchedFiles = new Set<string>();
  let postPatchQARerun: PostPatchQARerun | undefined;

  if (healApply === 'verified' && mode === 'transpiler-patch') {
    // Sort by lane order: parser first, then transpiler, then UI
    const laneOrder: Record<string, number> = { parser: 0, transpiler: 1, ui: 2 };
    const indices = allPendingPatches.map((_, i) => i);
    indices.sort((a, b) => (laneOrder[allPatchLanes[a]] ?? 99) - (laneOrder[allPatchLanes[b]] ?? 99));

    for (const i of indices) {
      const ref = allPatchRefs[i];
      if (ref.verdict !== 'pass') continue;

      const patch = allPendingPatches[i];
      if (!isPromotionAllowed(patch.transpiler_file)) continue;

      const normalizedTarget = normalizePatchPath(patch.transpiler_file);
      // Conflict: skip if already patched by earlier lane
      if (promotedPatchedFiles.has(normalizedTarget)) {
        ref.verdict = 'skipped-conflict';
        continue;
      }

      const filePath = join(process.cwd(), patch.transpiler_file);
      if (!existsSync(filePath)) continue;

      writeFileSync(filePath, patch.patched_content, 'utf-8');
      promotedFiles.push(patch.transpiler_file);
      promotedPatchedFiles.add(normalizedTarget);
    }

    // Post-patch QA rerun: re-run QA after all promotions
    if (promotedFiles.length > 0) {
      const failedStepsBefore = failedSteps;

      // Re-transpile if possible (to generate updated output from patched source)
      if (options.mockRetranspile) {
        options.mockRetranspile(process.cwd());
      } else if (options.airFilePath) {
        try {
          execSync(
            `npx tsx src/cli/index.ts transpile "${options.airFilePath}" -o "${options.outputDir}"`,
            { cwd: process.cwd(), encoding: 'utf-8', timeout: 30000, stdio: 'pipe' },
          );
        } catch {
          // Re-transpile failed — still run QA to check current state
        }
      }

      const rerunResult = await options.executeFlow(options.flowSpec, {
        headless,
        flowPath: '<auto-generated>',
        baselineMode: options.baselineMode,
      });

      const rerunFailed = rerunResult.steps.filter(s => s.status === 'fail').length;
      const rerunDeadCtas = rerunResult.steps.filter(s => s.dead_cta_detected).length;
      const delta = failedStepsBefore - rerunFailed;

      postPatchQARerun = {
        ran: true,
        verdict: rerunResult.verdict === 'pass' ? 'pass' : (delta > 0 ? 'pass' : 'fail'),
        improvementDelta: delta,
        totalSteps: rerunResult.steps.length,
        failedSteps: rerunFailed,
        deadCtas: rerunDeadCtas,
      };

      // If rerun passes or improves, update state
      if (rerunResult.verdict === 'pass' || delta > 0) {
        qaResult = rerunResult;
        failedSteps = rerunFailed;
        deadCtas = rerunDeadCtas;
      }
    }
  }

  // ---- Compute Final Verdict ----
  const allPassed = allPatchRefs.filter(p => p.verdict === 'pass').length;
  const anyFixed = allPassed > 0 ||
    (runtimeReport?.issuesFixed ?? 0) > 0 ||
    (uiReport?.patchesApplied ?? 0) > 0;

  let verdict: 'pass' | 'fail' | 'partial';
  if (postPatchQARerun?.ran && postPatchQARerun.verdict === 'pass') {
    verdict = failedSteps === 0 ? 'pass' : 'partial';
  } else if (failedSteps === 0) {
    verdict = 'pass';
  } else if (anyFixed) {
    verdict = 'partial';
  } else {
    verdict = 'fail';
  }

  return {
    qaVerdict: qaResult.verdict,
    totalSteps: qaResult.steps.length,
    deadCtas,
    failedSteps,
    classifications,
    transpilerPatches: allPatchRefs,
    promotedFiles,
    verdict,
    durationMs: Math.round(performance.now() - start),
    runtimeRemediation: runtimeReport,
    uiRemediation: uiReport,
    lanes,
    postPatchQARerun,
  };
}
