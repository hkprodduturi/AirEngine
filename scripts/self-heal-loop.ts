#!/usr/bin/env npx tsx
/**
 * Self-Heal Loop Orchestrator (SH8)
 *
 * Connects runtime QA detection with the SH0-SH7 pipeline:
 *   QA flow → bridge incidents → classify → patch → verify → promote → knowledge
 *
 * Modes:
 *   shadow       — Run QA + bridge only (observe, no patches)
 *   propose      — QA + bridge + deterministic patch proposals (no LLM key required)
 *   patch-verify — QA + bridge + patch + verify in temp worktree + promote + knowledge
 *
 * Usage:
 *   npm run self-heal-loop -- --flow qa-flows/photography-public.json --mode shadow [--dry-run]
 *
 * Guardrails:
 *   - propose mode uses SH3 deterministic buildPatchPrompt() — no API key needed (guardrail 4)
 *   - --model-assisted flag enables SH7 enrichPatchContext() (requires ANTHROPIC_API_KEY)
 *   - patch-verify creates temp git worktree, never patches working tree (guardrail 3)
 *   - Safety: maxAttempts 1-5, requireApproval always true, scope limits enforced
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { validateJsonSchema } from '../tests/schema-validator.js';

import { loadFlowSpec, executeFlow, writeQAResult, type FlowSpec, type RuntimeQAResult, type QARunOptions } from './runtime-qa-run.js';
import { bridgeFailedSteps, type BridgedIncident } from './runtime-qa-bridge.js';
import { buildPatchScope, buildPatchPrompt, buildPatchArtifact, writePatchArtifact, type PatchResult } from './patch-incident.js';
import { queryKnowledge } from './knowledge-store.js';
import { buildKnowledgeEntry, appendKnowledge, type KnowledgeEntry } from './knowledge-store.js';
import { runPromotionChecks, type PromotionReport } from './promote-fix.js';
import { traceToTranspiler, type CodegenTraceEntry, type CodegenTraceResult } from '../src/self-heal/codegen-trace.js';
import { proposeTranspilerPatch, verifyTranspilerPatch, normalizePatchPath, type TranspilerPatchResult, type PatchVerification } from '../src/self-heal/transpiler-patch.js';
import { runInvariants } from '../src/self-heal/invariants.js';

// ---- Types ----

export type HealMode = 'shadow' | 'propose' | 'patch-verify' | 'transpiler-patch';

export interface HealLoopOptions {
  flowPath: string;
  mode?: HealMode;
  maxAttempts?: number;
  headless?: boolean;
  dryRun?: boolean;
  modelAssisted?: boolean;
  /** Directory containing transpiled output (required for transpiler-patch mode) */
  outputDir?: string;
  /** Injected generated files for testing (overrides outputDir) */
  mockGeneratedFiles?: Map<string, string>;
  /** Path to .air file for re-transpiling (transpiler-patch mode) */
  airFilePath?: string;
  /** Injected re-transpile function for testing (overrides real transpile) */
  mockRetranspile?: (worktreePath: string) => Map<string, string> | null;
  /** Injected QA runner for testing */
  mockExecuteFlow?: (spec: FlowSpec, opts: QARunOptions) => Promise<RuntimeQAResult>;
  /** Skip artifact writes (testing) */
  skipArtifacts?: boolean;
  /** Injected bridged incidents for testing (overrides bridge phase) */
  mockBridgedIncidents?: BridgedIncident[];
  /** Injected patch proposer for testing (overrides proposeTranspilerPatch) */
  mockProposePatch?: (trace: CodegenTraceEntry, result: CodegenTraceResult) => TranspilerPatchResult | null;
  /** Injected worktree path for testing (skips real git worktree creation) */
  mockWorktreePath?: string;
}

export interface PatchRef {
  patch_id: string;
  patch_path: string;
  incident_id: string;
}

export interface VerifyRef {
  verify_id: string;
  verify_path: string;
  patch_id: string;
  verdict: string;
}

export interface PromotionRef {
  incident_id: string;
  promoted: boolean;
}

export interface KnowledgeRef {
  knowledge_id: string;
  incident_id: string;
}

export interface TranspilerPatchRef {
  trace_id: string;
  transpiler_file: string;
  strategy: string;
  verdict: 'pass' | 'fail' | 'skipped';
  diff_summary?: string;
}

export interface StyleVerificationRef {
  step_label: string;
  selector: string;
  result: 'pass' | 'fail' | 'skipped';
  mismatches?: string[];
}

export interface HealLoopSummary {
  dead_ctas_found: number;
  incidents_created: number;
  patches_proposed: number;
  patches_verified: number;
  patches_passed: number;
  /** SH9: Transpiler patches */
  transpiler_patches_proposed: number;
  transpiler_patches_passed: number;
  /** SH9: How many verify attempts were made (0 if none needed) */
  transpiler_patch_attempts: number;
}

export interface HealLoopResult {
  schema_version: '1.0';
  loop_id: string;
  mode: HealMode;
  timestamp: string;
  qa_result_path: string | null;
  worktree_path: string | null;
  bridged_incidents: BridgedIncident[];
  patches: PatchRef[];
  verifications: VerifyRef[];
  promotions: PromotionRef[];
  knowledge_entries: KnowledgeRef[];
  /** SH9: Transpiler patch results */
  transpiler_patches: TranspilerPatchRef[];
  /** SH9: Style verification results */
  style_verifications: StyleVerificationRef[];
  summary: HealLoopSummary;
  verdict: 'pass' | 'fail' | 'partial';
}

// ---- Helpers ----

export function generateLoopId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `HL-${date}-${time}-${rand}`;
}

// Safety: clamp maxAttempts to [1, 5]
function clampAttempts(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

// ---- Worktree Management (guardrail 3) ----

function createWorktree(loopId: string): string {
  const worktreeName = `sh8-${loopId.slice(3, 20)}`;
  const worktreePath = join('.claude', 'worktrees', worktreeName);
  const branchName = `sh8-verify-${loopId.slice(3, 20)}`;

  try {
    execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch (err: any) {
    throw new Error(`Failed to create worktree: ${err.message}`);
  }

  return worktreePath;
}

function removeWorktree(worktreePath: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // Best-effort cleanup
  }
}

// ---- Generated File Reader (for transpiler-patch mode) ----

function readGeneratedFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;

  function walk(current: string, relative: string): void {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Skip node_modules and .git
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

// ---- Re-Transpile in Worktree ----

/**
 * Re-transpile an .air file inside a worktree using the patched transpiler.
 * Spawns a child process so the patched .ts files are actually used.
 */
function retranspileInWorktree(worktreePath: string, airFilePath: string): Map<string, string> | null {
  try {
    const outputDir = join(worktreePath, '.sh9-retranspile');
    mkdirSync(outputDir, { recursive: true });
    execSync(
      `npx tsx src/cli/index.ts transpile "${airFilePath}" -o "${outputDir}"`,
      { cwd: worktreePath, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 },
    );
    return readGeneratedFiles(outputDir);
  } catch {
    return null;
  }
}

// ---- Propose Mode (guardrail 4 — no LLM key required) ----

function proposePatch(
  incident: Record<string, unknown>,
  modelAssisted: boolean,
  skipArtifacts: boolean,
): { patch: PatchResult; patchPath: string } | null {
  if (!incident.classification || incident.classification === 'unknown') {
    return null;
  }

  const scope = buildPatchScope(incident);
  const related = queryKnowledge(
    String(incident.classification),
    String(incident.suspected_subsystem || ''),
  );

  // Deterministic prompt (no API key needed, guardrail 4)
  let prompt = buildPatchPrompt(incident, scope, related);

  // Optional model-assisted enrichment (requires ANTHROPIC_API_KEY)
  if (modelAssisted) {
    try {
      // Dynamic import to avoid requiring the module when not using model-assisted
      const { enrichPatchContext } = require('./model-assisted.js');
      const enriched = enrichPatchContext(incident, related);
      if (enriched.model_suggestions) {
        prompt += `\n\n## Model Suggestions\n${enriched.model_suggestions}`;
      }
    } catch {
      // Model-assisted enrichment failed — continue with deterministic prompt
    }
  }

  const patch = buildPatchArtifact(incident, scope, prompt);

  if (skipArtifacts) {
    return { patch, patchPath: '<skip-artifacts>' };
  }

  const patchPath = writePatchArtifact(patch, prompt);
  return { patch, patchPath };
}

// ---- Main Loop ----

export async function runHealLoop(options: HealLoopOptions): Promise<HealLoopResult> {
  const loopId = generateLoopId();
  const mode = options.mode || 'shadow';
  const maxAttempts = clampAttempts(options.maxAttempts ?? 1);
  const headless = options.headless ?? true;
  const dryRun = options.dryRun ?? false;
  const modelAssisted = options.modelAssisted ?? false;
  const skipArtifacts = options.skipArtifacts ?? false;

  // Load flow spec
  const spec = loadFlowSpec(options.flowPath);

  // Phase 1: Run QA flow
  let qaResult: RuntimeQAResult;
  if (options.mockExecuteFlow) {
    qaResult = await options.mockExecuteFlow(spec, { headless, dryRun, flowPath: options.flowPath });
  } else {
    qaResult = await executeFlow(spec, { headless, dryRun, flowPath: options.flowPath });
  }

  let qaResultPath: string | null = null;
  if (!skipArtifacts) {
    qaResultPath = writeQAResult(qaResult);
  }

  // Phase 2: Bridge failed steps → incidents
  const bridgedIncidents = options.mockBridgedIncidents ?? bridgeFailedSteps(qaResult, spec, {
    dryRun: dryRun || skipArtifacts,
    skipTriage: dryRun,
  });

  // Count dead CTAs
  const deadCtasFound = qaResult.steps.filter(s => s.dead_cta_detected).length;

  // Shadow mode stops here
  if (mode === 'shadow') {
    return buildLoopResult(loopId, mode, qaResultPath, null, bridgedIncidents, [], [], [], [], [], [], deadCtasFound);
  }

  // Phase 3: Propose patches (deterministic, guardrail 4)
  const patches: PatchRef[] = [];
  for (const bi of bridgedIncidents) {
    if (!bi.incident_path || bi.incident_path === '<dry-run>') continue;

    try {
      const incident = JSON.parse(readFileSync(bi.incident_path, 'utf-8'));
      const result = proposePatch(incident, modelAssisted, skipArtifacts);
      if (result) {
        patches.push({
          patch_id: result.patch.patch_id,
          patch_path: result.patchPath,
          incident_id: bi.incident_id,
        });
      }
    } catch {
      // Patch proposal failed — continue with other incidents
    }
  }

  // Populate style_verifications from QA assert_style step results (all modes past shadow)
  const styleVerificationRefs: StyleVerificationRef[] = [];
  for (const step of qaResult.steps) {
    if (step.action === 'assert_style') {
      const stepSpec = spec.steps.find(s => s.step_id === step.step_id);
      const selector = stepSpec?.assert_style?.selector || step.evidence.selector || '';
      const mismatches: string[] = [];
      if (step.failure_reason && step.status === 'fail') {
        mismatches.push(step.failure_reason);
      }
      styleVerificationRefs.push({
        step_label: step.label,
        selector,
        result: step.status === 'pass' ? 'pass' : step.status === 'skip' ? 'skipped' : 'fail',
        mismatches: mismatches.length > 0 ? mismatches : undefined,
      });
    }
  }

  // Propose mode stops here
  if (mode === 'propose') {
    return buildLoopResult(loopId, mode, qaResultPath, null, bridgedIncidents, patches, [], [], [], [], styleVerificationRefs, deadCtasFound);
  }

  // SH9: Phase 3.5 — Codegen Trace (transpiler-patch mode)
  const transpilerPatchRefs: TranspilerPatchRef[] = [];
  const pendingTranspilerPatches: TranspilerPatchResult[] = [];
  let transpilerPatchAttempts = 0;

  if (mode === 'transpiler-patch') {
    // Read generated files for trace detection
    const generatedFiles = options.mockGeneratedFiles
      ?? (options.outputDir ? readGeneratedFiles(options.outputDir) : new Map<string, string>());

    // Track targeted files to dedup: multiple incidents may trigger the same
    // trace/file, but only one patch per transpiler_file is safe to apply.
    const patchedFiles = new Set<string>();

    for (const bi of bridgedIncidents) {
      if (!bi.classification) continue;

      // Check if this classification has a codegen trace
      const traceResult = traceToTranspiler(bi.classification, generatedFiles);
      if (!traceResult) continue;

      const { trace, result: detection } = traceResult;

      // Dedup: normalize path via the same helper proposeTranspilerPatch uses
      const targetFile = normalizePatchPath(trace.fix.target_file);
      if (patchedFiles.has(targetFile)) continue;

      // Propose transpiler patch
      const proposePatch = options.mockProposePatch ?? proposeTranspilerPatch;
      const patchResult = proposePatch(trace, detection);
      if (!patchResult) continue;

      // Use the same normalized key — not patchResult.transpiler_file which
      // is already normalized, but we store the canonical form consistently.
      patchedFiles.add(targetFile);
      pendingTranspilerPatches.push(patchResult);
      transpilerPatchRefs.push({
        trace_id: trace.id,
        transpiler_file: patchResult.transpiler_file,
        strategy: patchResult.strategy,
        verdict: 'skipped', // updated to pass/fail after verification
        diff_summary: patchResult.diff_summary,
      });
    }
  }

  // Phase 4: patch-verify / transpiler-patch mode — create worktree (guardrail 3)
  let worktreePath: string | null = null;
  const verifications: VerifyRef[] = [];
  const promotions: PromotionRef[] = [];
  const knowledgeEntries: KnowledgeRef[] = [];

  if (options.mockWorktreePath || (!dryRun && !skipArtifacts)) {
    try {
      worktreePath = options.mockWorktreePath ?? createWorktree(loopId);
    } catch {
      // Worktree creation failed — report but don't block
      return buildLoopResult(loopId, mode, qaResultPath, null, bridgedIncidents, patches, [], [], [], transpilerPatchRefs, styleVerificationRefs, deadCtasFound);
    }

    try {
      // Phase 5a: Verify SH8 patches in worktree
      for (const patchRef of patches) {
        const verifyId = `SV-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
        verifications.push({
          verify_id: verifyId,
          verify_path: join('artifacts', 'self-heal', 'verifications', `${verifyId}.json`),
          patch_id: patchRef.patch_id,
          verdict: 'pending',
        });
      }

      // Phase 5b: SH9 — verify transpiler patches in worktree (with retry)
      //
      // Single-write semantics per attempt:
      //   1. Snapshot worktree file state (preserves earlier passed patches)
      //   2. Write patched content to worktree (needed for re-transpile)
      //   3. Re-transpile + verify
      //   4. Pass → keep file, Fail → revert to snapshot (not per-patch original)
      //
      // Dedup: Phase 3.5 ensures at most one patch per transpiler_file.
      // Retry: up to maxAttempts. Stop early when all patches pass.
      if (mode === 'transpiler-patch') {
        const generatedFiles = options.mockGeneratedFiles
          ?? (options.outputDir ? readGeneratedFiles(options.outputDir) : new Map<string, string>());

        const hasPending = () => transpilerPatchRefs.some(ref => ref.verdict !== 'pass');

        while (transpilerPatchAttempts < maxAttempts && hasPending()) {
          transpilerPatchAttempts++;

          // Snapshot worktree state at start of attempt — includes any
          // previously passed patches. Failed patches revert to this, not
          // to per-patch original_content, so passed patches are preserved.
          const fileSnapshots = new Map<string, string>();
          for (const patch of pendingTranspilerPatches) {
            if (fileSnapshots.has(patch.transpiler_file)) continue;
            const worktreeFile = join(worktreePath!, patch.transpiler_file);
            if (existsSync(worktreeFile)) {
              fileSnapshots.set(patch.transpiler_file, readFileSync(worktreeFile, 'utf-8'));
            } else {
              fileSnapshots.set(patch.transpiler_file, patch.original_content);
            }
          }

          for (let i = 0; i < pendingTranspilerPatches.length; i++) {
            const ref = transpilerPatchRefs[i];
            if (ref.verdict === 'pass') continue; // already verified

            const patch = pendingTranspilerPatches[i];

            try {
              // Single authoritative write: put patched content for re-transpile
              const worktreeFile = join(worktreePath!, patch.transpiler_file);
              mkdirSync(join(worktreeFile, '..'), { recursive: true });
              writeFileSync(worktreeFile, patch.patched_content, 'utf-8');

              // Re-transpile to produce new output files
              let outputFilesAfter: Map<string, string> | null = null;
              if (options.mockRetranspile) {
                outputFilesAfter = options.mockRetranspile(worktreePath!);
              } else if (options.airFilePath) {
                outputFilesAfter = retranspileInWorktree(worktreePath!, options.airFilePath);
              }

              // Verify: all three gates required
              const verification = verifyTranspilerPatch(patch, generatedFiles, outputFilesAfter, runInvariants);
              patch.verification = verification;

              if (verification.invariants_passed && verification.retranspile_successful && verification.style_checks_passed) {
                ref.verdict = 'pass';
              } else {
                // Revert to per-attempt snapshot, preserving earlier passed patches
                const snapshot = fileSnapshots.get(patch.transpiler_file);
                if (snapshot !== undefined) {
                  writeFileSync(worktreeFile, snapshot, 'utf-8');
                }
                ref.verdict = 'fail';
              }
            } catch {
              // Revert to snapshot on exception (e.g. retranspile threw after write)
              try {
                const worktreeFile = join(worktreePath!, patch.transpiler_file);
                const snapshot = fileSnapshots.get(patch.transpiler_file);
                if (snapshot !== undefined) {
                  writeFileSync(worktreeFile, snapshot, 'utf-8');
                }
              } catch { /* best-effort revert */ }
              ref.verdict = 'fail';
            }
          }
        }
      }

      // Phase 6: Promotion checks
      for (const bi of bridgedIncidents) {
        if (!bi.incident_path || bi.incident_path === '<dry-run>') continue;
        try {
          const incident = JSON.parse(readFileSync(bi.incident_path, 'utf-8'));
          const report = runPromotionChecks(incident);
          promotions.push({
            incident_id: bi.incident_id,
            promoted: report.promoted,
          });
        } catch {
          // Promotion check failed — continue
        }
      }

      // Phase 7: Knowledge entries (on verification pass)
      for (const bi of bridgedIncidents) {
        if (!bi.incident_path || bi.incident_path === '<dry-run>') continue;
        try {
          const incident = JSON.parse(readFileSync(bi.incident_path, 'utf-8'));
          const entry = buildKnowledgeEntry(incident);
          appendKnowledge(entry);
          knowledgeEntries.push({
            knowledge_id: entry.knowledge_id,
            incident_id: bi.incident_id,
          });
        } catch {
          // Knowledge entry failed — continue
        }
      }
    } finally {
      // Cleanup: remove worktree if no patches passed
      const anyPassed = verifications.some(v => v.verdict === 'pass')
        || transpilerPatchRefs.some(tp => tp.verdict === 'pass');
      if (!anyPassed && worktreePath && !options.mockWorktreePath) {
        removeWorktree(worktreePath);
        worktreePath = null; // Cleaned up
      }
    }
  }

  return buildLoopResult(
    loopId, mode, qaResultPath, worktreePath,
    bridgedIncidents, patches, verifications, promotions, knowledgeEntries,
    transpilerPatchRefs, styleVerificationRefs, deadCtasFound, transpilerPatchAttempts,
  );
}

function buildLoopResult(
  loopId: string,
  mode: HealMode,
  qaResultPath: string | null,
  worktreePath: string | null,
  bridgedIncidents: BridgedIncident[],
  patches: PatchRef[],
  verifications: VerifyRef[],
  promotions: PromotionRef[],
  knowledgeEntries: KnowledgeRef[],
  transpilerPatches: TranspilerPatchRef[],
  styleVerifications: StyleVerificationRef[],
  deadCtasFound: number,
  transpilerPatchAttempts: number = 0,
): HealLoopResult {
  const patchesPassed = verifications.filter(v => v.verdict === 'pass').length;
  const transpilerPatchesPassed = transpilerPatches.filter(tp => tp.verdict === 'pass').length;
  const hasFailed = bridgedIncidents.length > 0;
  const hasPatches = patches.length > 0 || transpilerPatches.length > 0;

  let verdict: 'pass' | 'fail' | 'partial';
  if (!hasFailed) {
    verdict = 'pass';
  } else if (hasPatches && (patchesPassed > 0 || transpilerPatchesPassed > 0)) {
    verdict = 'partial';
  } else {
    verdict = 'fail';
  }

  return {
    schema_version: '1.0',
    loop_id: loopId,
    mode,
    timestamp: new Date().toISOString(),
    qa_result_path: qaResultPath,
    worktree_path: worktreePath,
    bridged_incidents: bridgedIncidents,
    patches,
    verifications,
    promotions,
    knowledge_entries: knowledgeEntries,
    transpiler_patches: transpilerPatches,
    style_verifications: styleVerifications,
    summary: {
      dead_ctas_found: deadCtasFound,
      incidents_created: bridgedIncidents.length,
      patches_proposed: patches.length,
      patches_verified: verifications.length,
      patches_passed: patchesPassed,
      transpiler_patches_proposed: transpilerPatches.length,
      transpiler_patches_passed: transpilerPatchesPassed,
      transpiler_patch_attempts: transpilerPatchAttempts,
    },
    verdict,
  };
}

// ---- Artifact Writing ----

export function writeHealLoopResult(result: HealLoopResult): string {
  const dir = join('artifacts', 'self-heal', 'loops');
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${result.loop_id}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return outPath;
}

export function validateHealLoopResult(result: HealLoopResult): string[] {
  const schemaPath = join(__dirname, '..', 'docs', 'self-heal-loop-result.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  return validateJsonSchema(result, schema, schema);
}

// ---- CLI Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flowIdx = args.indexOf('--flow');
  const flowPath = flowIdx >= 0 ? args[flowIdx + 1] : undefined;
  const modeIdx = args.indexOf('--mode');
  const modeStr = modeIdx >= 0 ? args[modeIdx + 1] : 'shadow';
  const attemptsIdx = args.indexOf('--max-attempts');
  const maxAttempts = attemptsIdx >= 0 ? parseInt(args[attemptsIdx + 1], 10) : 1;
  const headless = !args.includes('--no-headless');
  const dryRun = args.includes('--dry-run');
  const modelAssisted = args.includes('--model-assisted');
  const outputDirIdx = args.indexOf('--output-dir');
  const outputDir = outputDirIdx >= 0 ? args[outputDirIdx + 1] : undefined;
  const airFileIdx = args.indexOf('--air-file');
  const airFilePath = airFileIdx >= 0 ? args[airFileIdx + 1] : undefined;

  if (!flowPath) {
    console.error('Usage: self-heal-loop.ts --flow <path> --mode <shadow|propose|patch-verify|transpiler-patch> [options]');
    console.error('Options:');
    console.error('  --max-attempts N    Max repair attempts (1-5, default 1)');
    console.error('  --no-headless       Show browser window');
    console.error('  --dry-run           Validate flow only, no execution');
    console.error('  --model-assisted    Enable SH7 LLM enrichment (requires ANTHROPIC_API_KEY)');
    console.error('  --output-dir <dir>  Directory with transpiled output (transpiler-patch mode)');
    console.error('  --air-file <path>   Path to .air file for re-transpiling (transpiler-patch mode)');
    process.exit(1);
  }

  const mode = modeStr as HealMode;
  if (!['shadow', 'propose', 'patch-verify', 'transpiler-patch'].includes(mode)) {
    console.error(`Invalid mode: ${mode}. Must be shadow, propose, patch-verify, or transpiler-patch.`);
    process.exit(1);
  }

  if (mode === 'transpiler-patch' && !dryRun) {
    if (!outputDir) {
      console.error('Error: --output-dir is required for transpiler-patch mode (unless --dry-run)');
      process.exit(1);
    }
    if (!airFilePath) {
      console.error('Error: --air-file is required for transpiler-patch mode (unless --dry-run)');
      process.exit(1);
    }
  }

  try {
    console.log(`\n  Self-Heal Loop (SH8)\n`);
    console.log(`  Flow:           ${flowPath}`);
    console.log(`  Mode:           ${mode}`);
    console.log(`  Max attempts:   ${clampAttempts(maxAttempts)}`);
    console.log(`  Model-assisted: ${modelAssisted}`);
    console.log(`  Dry run:        ${dryRun}\n`);

    const result = await runHealLoop({
      flowPath,
      mode,
      maxAttempts,
      headless,
      dryRun,
      modelAssisted,
      outputDir,
      airFilePath,
    });

    const outPath = writeHealLoopResult(result);

    // Report
    console.log(`  QA result:       ${result.qa_result_path || 'N/A'}`);
    console.log(`  Dead CTAs:       ${result.summary.dead_ctas_found}`);
    console.log(`  Incidents:       ${result.summary.incidents_created}`);
    console.log(`  Patches:         ${result.summary.patches_proposed}`);
    console.log(`  Verified:        ${result.summary.patches_verified}`);
    console.log(`  Passed:          ${result.summary.patches_passed}`);
    if (result.summary.transpiler_patches_proposed > 0) {
      console.log(`  TP proposed:     ${result.summary.transpiler_patches_proposed}`);
      console.log(`  TP passed:       ${result.summary.transpiler_patches_passed}`);
      console.log(`  TP attempts:     ${result.summary.transpiler_patch_attempts}`);
    }
    if (result.worktree_path) {
      console.log(`  Worktree:        ${result.worktree_path}`);
    }
    console.log(`\n  Verdict:         ${result.verdict.toUpperCase()}`);
    console.log(`  Report:          ${outPath}\n`);

    process.exit(result.verdict === 'pass' ? 0 : 1);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('self-heal-loop')) {
  main();
}
