/**
 * SH9 Transpiler Patch Engine
 *
 * Proposes, verifies, and applies patches to transpiler source code.
 * Only patches transpiler/self-heal source — never generated output.
 *
 * Scope limits enforced: max 3 files, max 50 lines changed per patch.
 * All patches run in a worktree and must pass verification before promotion.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { CodegenTraceEntry, CodegenTraceResult } from './codegen-trace.js';
import type { InvariantResult, InvariantSummary } from './invariants.js';

// ---- Types ----

export interface TranspilerPatchResult {
  trace_id: string;
  transpiler_file: string;
  transpiler_function: string;
  original_content: string;
  patched_content: string;
  diff_summary: string;
  strategy: string;
  verification: PatchVerification | null;
}

export interface PatchVerification {
  invariants_passed: boolean;
  invariant_results: InvariantResult[];
  retranspile_successful: boolean;
  style_checks_passed: boolean;
  output_hash_before: string;
  output_hash_after: string;
}

// Scope limits
const MAX_FILES_PER_PATCH = 3;
const MAX_LINES_CHANGED = 50;

// Hard guardrail: self-heal may patch only framework source files, never generated output.
const FRAMEWORK_PATCH_PREFIXES = [
  'src/transpiler/',
  'src/self-heal/',
  'src/parser/',
  'scripts/',
];

const GENERATED_OUTPUT_PREFIXES = [
  'output/',
  'demo-output/',
  'dist/',
  'artifacts/',
  '.air-artifacts/',
  'test-output/',
  'test-output-auth/',
  'test-output-dashboard/',
  'test-output-expense/',
  'test-output-landing/',
];

export function normalizePatchPath(targetFile: string): string {
  return targetFile.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Returns true only for framework-owned source files:
 *   - .air specs (outside generated dirs)
 *   - transpiler/self-heal/framework script source files
 */
export function isAllowedSelfHealPatchTarget(targetFile: string): boolean {
  const normalized = normalizePatchPath(targetFile.trim());
  if (!normalized) return false;

  // Disallow absolute paths and path traversal.
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.split('/').includes('..')) return false;

  // Never patch generated outputs/artifacts.
  if (GENERATED_OUTPUT_PREFIXES.some(prefix => normalized.startsWith(prefix))) return false;

  // Allow .air input specs anywhere in repo (except generated dirs above).
  if (normalized.endsWith('.air')) return true;

  // Allow framework source directories only.
  return FRAMEWORK_PATCH_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

// ---- Diff Summary ----

function computeDiffSummary(original: string, patched: string): { summary: string; linesChanged: number } {
  const origLines = original.split('\n');
  const patchLines = patched.split('\n');
  let added = 0;
  let removed = 0;

  // Simple line-by-line diff (not a real diff algorithm, but sufficient for scope checking)
  const maxLen = Math.max(origLines.length, patchLines.length);
  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i] ?? '';
    const patchLine = patchLines[i] ?? '';
    if (origLine !== patchLine) {
      if (i < origLines.length) removed++;
      if (i < patchLines.length) added++;
    }
  }

  const linesChanged = Math.max(added, removed);
  const summary = `+${added} -${removed} lines (${linesChanged} changed)`;
  return { summary, linesChanged };
}

// ---- Content Hash ----

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ---- Propose ----

/**
 * Read transpiler source from disk, apply the trace's fix.apply(),
 * and return a patch result with diff summary.
 */
export function proposeTranspilerPatch(
  trace: CodegenTraceEntry,
  traceResult: CodegenTraceResult,
  projectRoot: string = process.cwd(),
): TranspilerPatchResult | null {
  const targetFile = normalizePatchPath(trace.fix.target_file);
  if (!isAllowedSelfHealPatchTarget(targetFile)) {
    return null;
  }

  const filePath = join(projectRoot, targetFile);
  if (!existsSync(filePath)) {
    return null;
  }

  const originalContent = readFileSync(filePath, 'utf-8');
  const patchedContent = trace.fix.apply(originalContent, traceResult);

  // No change
  if (originalContent === patchedContent) {
    return null;
  }

  const { summary, linesChanged } = computeDiffSummary(originalContent, patchedContent);

  // Scope limit: max lines
  if (linesChanged > MAX_LINES_CHANGED) {
    return null;
  }

  return {
    trace_id: trace.id,
    transpiler_file: targetFile,
    transpiler_function: trace.fix.target_function,
    original_content: originalContent,
    patched_content: patchedContent,
    diff_summary: summary,
    strategy: trace.fix.strategy,
    verification: null,
  };
}

/**
 * Verify a transpiler patch by running invariants and checking output hashes.
 *
 * @param patch - The proposed patch
 * @param outputFilesBefore - Generated files before patching (for hash comparison)
 * @param outputFilesAfter - Generated files after re-transpiling with the patch
 * @param invariantRunner - Function to run invariants against generated files
 * @param styleChecker - Optional function to run style checks, returns pass/fail
 */
export function verifyTranspilerPatch(
  patch: TranspilerPatchResult,
  outputFilesBefore: Map<string, string>,
  outputFilesAfter: Map<string, string> | null,
  invariantRunner?: (files: Map<string, string>) => InvariantSummary,
  styleChecker?: (files: Map<string, string>) => boolean,
): PatchVerification {
  // Hash before
  const hashBefore = hashContent(
    [...outputFilesBefore.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([p, c]) => `${p}:${hashContent(c)}`).join('\n')
  );

  // Hash after (or same if no re-transpile output)
  const afterFiles = outputFilesAfter ?? outputFilesBefore;
  const hashAfter = hashContent(
    [...afterFiles.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([p, c]) => `${p}:${hashContent(c)}`).join('\n')
  );

  // Run invariants
  let invariantsPassed = true;
  let invariantResults: InvariantResult[] = [];
  if (invariantRunner) {
    const summary = invariantRunner(afterFiles);
    invariantsPassed = summary.failed === 0;
    invariantResults = summary.results;
  }

  // Re-transpile success: we have output files
  const retranspileSuccessful = outputFilesAfter !== null && outputFilesAfter.size > 0;

  // Style checks: use provided checker, or default to checking CSS invariants pass
  let styleChecksPassed: boolean;
  if (styleChecker) {
    styleChecksPassed = styleChecker(afterFiles);
  } else {
    // Default: check that no style-related invariants failed (INV-007, INV-010)
    const styleInvIds = ['INV-007', 'INV-010'];
    const styleFails = invariantResults.filter(r => styleInvIds.includes(r.id) && !r.passed);
    styleChecksPassed = styleFails.length === 0;
  }

  return {
    invariants_passed: invariantsPassed,
    invariant_results: invariantResults,
    retranspile_successful: retranspileSuccessful,
    style_checks_passed: styleChecksPassed,
    output_hash_before: hashBefore,
    output_hash_after: hashAfter,
  };
}

/**
 * Apply a verified transpiler patch to disk.
 * Only call this in a worktree after verification passes.
 *
 * @param patch - The verified patch
 * @param projectRoot - Root of the project (worktree root)
 */
export function applyTranspilerPatch(
  patch: TranspilerPatchResult,
  projectRoot: string = process.cwd(),
): boolean {
  if (!isAllowedSelfHealPatchTarget(patch.transpiler_file)) return false;
  if (!patch.verification) return false;
  if (!patch.verification.invariants_passed) return false;
  if (!patch.verification.retranspile_successful) return false;
  if (!patch.verification.style_checks_passed) return false;

  const filePath = join(projectRoot, patch.transpiler_file);
  if (!existsSync(filePath)) return false;
  writeFileSync(filePath, patch.patched_content, 'utf-8');
  return true;
}

/**
 * Check if a patch is within scope limits.
 */
export function isPatchWithinScope(patches: TranspilerPatchResult[]): boolean {
  if (patches.length > MAX_FILES_PER_PATCH) return false;
  for (const p of patches) {
    if (!isAllowedSelfHealPatchTarget(p.transpiler_file)) return false;
    const { linesChanged } = computeDiffSummary(p.original_content, p.patched_content);
    if (linesChanged > MAX_LINES_CHANGED) return false;
  }
  return true;
}
