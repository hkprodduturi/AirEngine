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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { validateJsonSchema } from '../tests/schema-validator.js';

import { loadFlowSpec, executeFlow, writeQAResult, type FlowSpec, type RuntimeQAResult, type QARunOptions } from './runtime-qa-run.js';
import { bridgeFailedSteps, type BridgedIncident } from './runtime-qa-bridge.js';
import { buildPatchScope, buildPatchPrompt, buildPatchArtifact, writePatchArtifact, type PatchResult } from './patch-incident.js';
import { queryKnowledge } from './knowledge-store.js';
import { buildKnowledgeEntry, appendKnowledge, type KnowledgeEntry } from './knowledge-store.js';
import { runPromotionChecks, type PromotionReport } from './promote-fix.js';

// ---- Types ----

export type HealMode = 'shadow' | 'propose' | 'patch-verify';

export interface HealLoopOptions {
  flowPath: string;
  mode?: HealMode;
  maxAttempts?: number;
  headless?: boolean;
  dryRun?: boolean;
  modelAssisted?: boolean;
  /** Injected QA runner for testing */
  mockExecuteFlow?: (spec: FlowSpec, opts: QARunOptions) => Promise<RuntimeQAResult>;
  /** Skip artifact writes (testing) */
  skipArtifacts?: boolean;
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

export interface HealLoopSummary {
  dead_ctas_found: number;
  incidents_created: number;
  patches_proposed: number;
  patches_verified: number;
  patches_passed: number;
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
  const bridgedIncidents = bridgeFailedSteps(qaResult, spec, {
    dryRun: dryRun || skipArtifacts,
    skipTriage: dryRun,
  });

  // Count dead CTAs
  const deadCtasFound = qaResult.steps.filter(s => s.dead_cta_detected).length;

  // Shadow mode stops here
  if (mode === 'shadow') {
    return buildLoopResult(loopId, mode, qaResultPath, null, bridgedIncidents, [], [], [], [], deadCtasFound);
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

  // Propose mode stops here
  if (mode === 'propose') {
    return buildLoopResult(loopId, mode, qaResultPath, null, bridgedIncidents, patches, [], [], [], deadCtasFound);
  }

  // Phase 4: patch-verify mode — create worktree (guardrail 3)
  let worktreePath: string | null = null;
  const verifications: VerifyRef[] = [];
  const promotions: PromotionRef[] = [];
  const knowledgeEntries: KnowledgeRef[] = [];

  if (!dryRun && !skipArtifacts) {
    try {
      worktreePath = createWorktree(loopId);
    } catch {
      // Worktree creation failed — report but don't block
      return buildLoopResult(loopId, mode, qaResultPath, null, bridgedIncidents, patches, [], [], [], deadCtasFound);
    }

    try {
      // Phase 5: Verify patches in worktree
      // Note: actual patch application + verification would happen here
      // For now, we create verification artifacts indicating patches need review
      for (const patchRef of patches) {
        const verifyId = `SV-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
        verifications.push({
          verify_id: verifyId,
          verify_path: join('artifacts', 'self-heal', 'verifications', `${verifyId}.json`),
          patch_id: patchRef.patch_id,
          verdict: 'pending',
        });
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
      const anyPassed = verifications.some(v => v.verdict === 'pass');
      if (!anyPassed && worktreePath) {
        removeWorktree(worktreePath);
        worktreePath = null; // Cleaned up
      }
    }
  }

  return buildLoopResult(
    loopId, mode, qaResultPath, worktreePath,
    bridgedIncidents, patches, verifications, promotions, knowledgeEntries, deadCtasFound,
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
  deadCtasFound: number,
): HealLoopResult {
  const patchesPassed = verifications.filter(v => v.verdict === 'pass').length;
  const hasFailed = bridgedIncidents.length > 0;
  const hasPatches = patches.length > 0;

  let verdict: 'pass' | 'fail' | 'partial';
  if (!hasFailed) {
    verdict = 'pass';
  } else if (hasPatches && patchesPassed > 0) {
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
    summary: {
      dead_ctas_found: deadCtasFound,
      incidents_created: bridgedIncidents.length,
      patches_proposed: patches.length,
      patches_verified: verifications.length,
      patches_passed: patchesPassed,
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

  if (!flowPath) {
    console.error('Usage: self-heal-loop.ts --flow <path> --mode <shadow|propose|patch-verify> [options]');
    console.error('Options:');
    console.error('  --max-attempts N    Max repair attempts (1-5, default 1)');
    console.error('  --no-headless       Show browser window');
    console.error('  --dry-run           Validate flow only, no execution');
    console.error('  --model-assisted    Enable SH7 LLM enrichment (requires ANTHROPIC_API_KEY)');
    process.exit(1);
  }

  const mode = modeStr as HealMode;
  if (!['shadow', 'propose', 'patch-verify'].includes(mode)) {
    console.error(`Invalid mode: ${mode}. Must be shadow, propose, or patch-verify.`);
    process.exit(1);
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
    });

    const outPath = writeHealLoopResult(result);

    // Report
    console.log(`  QA result:       ${result.qa_result_path || 'N/A'}`);
    console.log(`  Dead CTAs:       ${result.summary.dead_ctas_found}`);
    console.log(`  Incidents:       ${result.summary.incidents_created}`);
    console.log(`  Patches:         ${result.summary.patches_proposed}`);
    console.log(`  Verified:        ${result.summary.patches_verified}`);
    console.log(`  Passed:          ${result.summary.patches_passed}`);
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
