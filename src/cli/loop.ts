/**
 * AirEngine Agent Loop Harness
 *
 * Runs the full pipeline: validate → repair → transpile → smoke → deliver.
 * Logs artifacts to .air-artifacts/<timestamp>/ for auditability.
 *
 * Stages (each tracked with pass/fail/skip + timing):
 *   1. validate:     Parse + diagnose, produce DiagnosticResult
 *   2. repair:       Deterministic single-pass repair (A3b: E001, E002)
 *   3. transpile:    Generate output files
 *   4. smoke:        L0 (files exist) + L1 (entry point, package.json, non-trivial)
 *   5. determinism:  Transpile twice, compare output hashes
 *
 * After stages complete, output files are written to the target directory.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { parse } from '../parser/index.js';
import { diagnose } from '../validator/index.js';
import { transpile } from '../transpiler/index.js';
import { buildResult, hashSource, formatDiagnosticCLI, wrapParseError } from '../diagnostics.js';
import type { DiagnosticResult } from '../diagnostics.js';
import type { TranspileResult, OutputFile } from '../transpiler/index.js';
import { repair, createDeterministicAdapter, createNoopAdapter } from '../repair.js';
import type { RepairAction, RepairStatus, RepairAdapter, RepairContext } from '../repair.js';

// ---- Types ----

export interface LoopStage {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface RepairAttempt {
  attemptNumber: number;
  sourceHash: string;
  errorsBefore: number;
  errorsAfter: number | null;
  durationMs: number;
  stopReason?: 'success' | 'noop' | 'no_improvement' | 'cycle_detected' | 'max_attempts';
}

export interface LoopResult {
  file: string;
  timestamp: string;
  stages: LoopStage[];
  diagnostics: DiagnosticResult;
  transpileResult?: TranspileResult;
  outputDir: string;
  artifactDir: string;
  determinismCheck: {
    sourceHash: string;
    outputHashes: Record<string, string>;
    deterministic: boolean;
  };
  repairResult?: {
    status: RepairStatus;
    attempted: boolean;
    appliedActions: RepairAction[];
    skippedActions: RepairAction[];
    beforeDiagnostics: DiagnosticResult;
    afterDiagnostics: DiagnosticResult | null;
    sourceChanged: boolean;
    repairedFile: string | null;
  };
  repairAttempts?: RepairAttempt[];
}

// ---- Hash Helpers ----

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function hashFiles(files: OutputFile[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const f of files) {
    hashes[f.path] = hashContent(f.content);
  }
  return hashes;
}

// ---- Stages ----

function stageValidate(source: string): { stage: LoopStage; diagnostics: DiagnosticResult; ast: ReturnType<typeof parse> | null } {
  const start = performance.now();
  try {
    const ast = parse(source);
    const diags = diagnose(ast);
    const result = buildResult(diags, hashSource(source));
    const durationMs = Math.round(performance.now() - start);

    return {
      stage: {
        name: 'validate',
        status: result.valid ? 'pass' : 'fail',
        durationMs,
        details: {
          errors: result.summary.errors,
          warnings: result.summary.warnings,
          info: result.summary.info,
        },
      },
      diagnostics: result,
      ast,
    };
  } catch (err: any) {
    const diag = wrapParseError(err);
    const result = buildResult([diag], hashSource(source));
    const durationMs = Math.round(performance.now() - start);

    return {
      stage: {
        name: 'validate',
        status: 'fail',
        durationMs,
        details: { parseError: err.message },
      },
      diagnostics: result,
      ast: null,
    };
  }
}

async function stageRepair(
  source: string,
  diagnostics: DiagnosticResult,
  artifactDir: string,
  writeArtifacts: boolean = true,
  adapter?: RepairAdapter,
  context?: RepairContext,
): Promise<{
  stage: LoopStage;
  updatedSource: string;
  updatedAst: ReturnType<typeof parse> | null;
  postRepairDiagnostics: DiagnosticResult | null;
  repairResult: LoopResult['repairResult'];
}> {
  const start = performance.now();
  const errorCount = diagnostics.summary.errors;

  // No errors → skip repair entirely
  if (errorCount === 0) {
    return {
      stage: {
        name: 'repair',
        status: 'skip',
        durationMs: Math.round(performance.now() - start),
        details: { reason: 'No errors to repair' },
      },
      updatedSource: source,
      updatedAst: null,
      postRepairDiagnostics: null,
      repairResult: undefined,
    };
  }

  // Run repair engine (use adapter if provided, otherwise raw repair())
  const repairRes = adapter
    ? await adapter.repair(source, diagnostics.diagnostics, context)
    : repair(source, diagnostics.diagnostics);
  const appliedActions = repairRes.actions.filter(a => a.applied);
  const skippedActions = repairRes.actions.filter(a => !a.applied);

  const repairResultPayload: LoopResult['repairResult'] = {
    status: repairRes.status,
    attempted: true,
    appliedActions,
    skippedActions,
    beforeDiagnostics: diagnostics,
    afterDiagnostics: null,
    sourceChanged: repairRes.sourceChanged,
    repairedFile: null,
  };

  // Always write audit artifacts when repair is attempted (if enabled)
  if (writeArtifacts) {
    writeFileSync(join(artifactDir, 'repair-actions.json'), JSON.stringify(repairRes.actions, null, 2));
    writeFileSync(join(artifactDir, 'diagnostics-before.json'), JSON.stringify(diagnostics, null, 2));
  }

  if (!repairRes.sourceChanged) {
    // No repairs could be applied
    return {
      stage: {
        name: 'repair',
        status: 'fail',
        durationMs: Math.round(performance.now() - start),
        details: {
          repairStatus: repairRes.status,
          applied: 0,
          skipped: skippedActions.length,
        },
      },
      updatedSource: source,
      updatedAst: null,
      postRepairDiagnostics: null,
      repairResult: repairResultPayload,
    };
  }

  // Source was modified — write repaired source, re-parse, re-diagnose
  if (writeArtifacts) {
    writeFileSync(join(artifactDir, 'repaired.air'), repairRes.repairedSource);
    repairResultPayload.repairedFile = join(artifactDir, 'repaired.air');
  }

  // Re-parse repaired source
  let newAst: ReturnType<typeof parse> | null = null;
  let afterDiagnostics: DiagnosticResult | null = null;
  try {
    newAst = parse(repairRes.repairedSource);
    const newDiags = diagnose(newAst);
    afterDiagnostics = buildResult(newDiags, hashSource(repairRes.repairedSource));
  } catch (err: any) {
    const diag = wrapParseError(err);
    afterDiagnostics = buildResult([diag], hashSource(repairRes.repairedSource));
    newAst = null;
  }

  if (writeArtifacts) writeFileSync(join(artifactDir, 'diagnostics-after.json'), JSON.stringify(afterDiagnostics, null, 2));
  repairResultPayload.afterDiagnostics = afterDiagnostics;

  const afterErrors = afterDiagnostics?.summary.errors ?? 0;
  const stageStatus: 'pass' | 'fail' = afterErrors === 0 && newAst ? 'pass' : 'fail';

  return {
    stage: {
      name: 'repair',
      status: stageStatus,
      durationMs: Math.round(performance.now() - start),
      details: {
        repairStatus: repairRes.status,
        applied: appliedActions.length,
        skipped: skippedActions.length,
        errorsBefore: diagnostics.summary.errors,
        errorsAfter: afterErrors,
      },
    },
    updatedSource: repairRes.repairedSource,
    updatedAst: newAst,
    postRepairDiagnostics: afterDiagnostics,
    repairResult: repairResultPayload,
  };
}

function stageTranspile(ast: ReturnType<typeof parse>, source: string): { stage: LoopStage; result: TranspileResult | null } {
  const start = performance.now();
  try {
    const sourceLines = source.split('\n').length;
    const result = transpile(ast, { sourceLines });
    const durationMs = Math.round(performance.now() - start);

    return {
      stage: {
        name: 'transpile',
        status: 'pass',
        durationMs,
        details: {
          files: result.files.length,
          outputLines: result.stats.outputLines,
          compressionRatio: result.stats.compressionRatio,
        },
      },
      result,
    };
  } catch (err: any) {
    return {
      stage: {
        name: 'transpile',
        status: 'fail',
        durationMs: Math.round(performance.now() - start),
        details: { error: err.message },
      },
      result: null,
    };
  }
}

function stageSmoke(files: OutputFile[]): LoopStage {
  const start = performance.now();
  const checks: Record<string, boolean> = {};

  // L0: Files exist (non-empty)
  const nonEmpty = files.filter(f => f.content.trim().length > 0);
  checks['L0_files_exist'] = nonEmpty.length === files.length;
  checks['L0_file_count'] = files.length > 0;

  // L1: Build check heuristics
  // Check for App.jsx or main entry
  const hasEntry = files.some(f =>
    f.path.endsWith('App.jsx') || f.path.endsWith('main.jsx') || f.path.endsWith('index.html')
  );
  checks['L1_has_entry'] = hasEntry;

  // Check for package.json
  const hasPkg = files.some(f => f.path.endsWith('package.json'));
  checks['L1_has_package_json'] = hasPkg;

  // Check: no files with only whitespace content
  const allNonTrivial = files.every(f => f.content.trim().length > 10);
  checks['L1_all_nontrivial'] = allNonTrivial;

  const allPassed = Object.values(checks).every(Boolean);
  const durationMs = Math.round(performance.now() - start);

  return {
    name: 'smoke',
    status: allPassed ? 'pass' : 'fail',
    durationMs,
    details: checks,
  };
}

function stageDeterminism(ast: ReturnType<typeof parse>, source: string, firstHashes: Record<string, string>): {
  stage: LoopStage;
  check: LoopResult['determinismCheck'];
} {
  const start = performance.now();
  const sourceLines = source.split('\n').length;
  const secondResult = transpile(ast, { sourceLines });
  const secondHashes = hashFiles(secondResult.files);

  // Compare hashes (exclude manifest since it has timestamps)
  let deterministic = true;
  for (const [path, hash] of Object.entries(firstHashes)) {
    if (path === '_airengine_manifest.json') continue;
    if (secondHashes[path] !== hash) {
      deterministic = false;
      break;
    }
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    stage: {
      name: 'determinism',
      status: deterministic ? 'pass' : 'fail',
      durationMs,
      details: { fileCount: Object.keys(firstHashes).length, deterministic },
    },
    check: {
      sourceHash: hashSource(source),
      outputHashes: firstHashes,
      deterministic,
    },
  };
}

// ---- Options ----

export interface LoopOptions {
  /** Repair mode: 'deterministic' (A3b rules), 'claude' (LLM-backed), or 'none' (skip repair) */
  repairMode?: 'deterministic' | 'claude' | 'none';
  /** Whether to write artifacts to disk (default: true) */
  writeArtifacts?: boolean;
  /** Maximum repair attempts (default: 1). >1 enables retry loop with adapter. */
  maxRepairAttempts?: number;
  /** Override repair adapter (takes precedence over repairMode) */
  repairAdapter?: RepairAdapter;
  /** Claude repair adapter options (used when repairMode='claude') */
  claudeRepairOptions?: {
    apiKey?: string;
    model?: string;
    maxRetries?: number;
    timeoutMs?: number;
  };
}

// ---- Main Loop (source-based) ----

/**
 * Run the full loop pipeline from source string.
 * Primary entry point for both CLI and MCP.
 */
export async function runLoopFromSource(
  source: string,
  outputDir: string,
  opts?: LoopOptions & { file?: string },
): Promise<LoopResult> {
  const repairMode = opts?.repairMode ?? 'deterministic';
  const writeArtifacts = opts?.writeArtifacts ?? true;
  const file = opts?.file ?? '<source>';
  const maxRepairAttempts = opts?.maxRepairAttempts ?? 1;

  // Resolve adapter from options
  let adapter: RepairAdapter | undefined = opts?.repairAdapter;
  if (!adapter) {
    if (repairMode === 'none') {
      adapter = undefined;
    } else if (repairMode === 'claude') {
      const apiKey = opts?.claudeRepairOptions?.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('Claude repair mode requires ANTHROPIC_API_KEY (set env or pass claudeRepairOptions.apiKey)');
      const { createClaudeRepairAdapter } = await import('../repair-claude.js');
      adapter = createClaudeRepairAdapter({
        apiKey,
        model: opts?.claudeRepairOptions?.model,
        maxRetries: opts?.claudeRepairOptions?.maxRetries,
        timeoutMs: opts?.claudeRepairOptions?.timeoutMs,
      });
    } else if (maxRepairAttempts > 1) {
      adapter = createDeterministicAdapter();
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join('.air-artifacts', timestamp);
  if (writeArtifacts) mkdirSync(artifactDir, { recursive: true });

  const stages: LoopStage[] = [];

  // Stage 1: Validate
  const { stage: validateStage, diagnostics, ast } = stageValidate(source);
  stages.push(validateStage);

  // Log diagnostics artifact
  if (writeArtifacts) writeFileSync(join(artifactDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));

  // Stage 2: Repair
  let repairPayload: LoopResult['repairResult'];
  let effectiveAst = ast;
  let effectiveDiagnostics = diagnostics;
  let effectiveSource = source;
  let repairAttempts: RepairAttempt[] | undefined;

  if (repairMode === 'none' || diagnostics.summary.errors === 0) {
    // Skip repair
    stages.push({
      name: 'repair',
      status: 'skip',
      durationMs: 0,
      details: { reason: repairMode === 'none' ? 'Repair disabled' : 'No errors to repair' },
    });
  } else if (maxRepairAttempts > 1 && adapter) {
    // Multi-attempt retry loop (A3d)
    const retryStart = performance.now();
    repairAttempts = [];
    const previousHashes: string[] = [];
    let currentSource = source;
    let currentDiagnostics = diagnostics;
    let lastRepairPayload: LoopResult['repairResult'];
    let lastAst = ast;
    let lastDiags = diagnostics;
    let lastSource = source;

    for (let attempt = 1; attempt <= maxRepairAttempts; attempt++) {
      const attemptStart = performance.now();
      const attemptDir = join(artifactDir, `attempt-${attempt}`);
      if (writeArtifacts) mkdirSync(attemptDir, { recursive: true });

      const context: RepairContext = {
        attemptNumber: attempt,
        maxAttempts: maxRepairAttempts,
        previousHashes: [...previousHashes],
      };

      const {
        stage: repairStage,
        updatedSource,
        updatedAst,
        postRepairDiagnostics,
        repairResult: rp,
      } = await stageRepair(currentSource, currentDiagnostics, attemptDir, writeArtifacts, adapter, context);

      lastRepairPayload = rp;
      const attemptDurationMs = Math.round(performance.now() - attemptStart);
      const errorsBefore = currentDiagnostics.summary.errors;
      const errorsAfter = postRepairDiagnostics?.summary.errors ?? null;
      const sourceHash = hashContent(updatedSource);

      const attemptRecord: RepairAttempt = {
        attemptNumber: attempt,
        sourceHash,
        errorsBefore,
        errorsAfter,
        durationMs: attemptDurationMs,
      };

      // Check stop conditions
      if (repairStage.status === 'skip' || !rp?.sourceChanged) {
        // (a) noop — adapter didn't change anything
        attemptRecord.stopReason = 'noop';
        repairAttempts.push(attemptRecord);
        break;
      }

      if (errorsAfter === 0 && updatedAst) {
        // (b) success — no errors remain
        attemptRecord.stopReason = 'success';
        repairAttempts.push(attemptRecord);
        lastAst = updatedAst;
        lastDiags = postRepairDiagnostics!;
        lastSource = updatedSource;
        break;
      }

      if (errorsAfter !== null && errorsAfter >= errorsBefore) {
        // (c) no improvement — errors not decreased
        attemptRecord.stopReason = 'no_improvement';
        repairAttempts.push(attemptRecord);
        break;
      }

      if (previousHashes.includes(sourceHash)) {
        // (d) cycle detected — hash seen before
        attemptRecord.stopReason = 'cycle_detected';
        repairAttempts.push(attemptRecord);
        break;
      }

      previousHashes.push(sourceHash);

      if (attempt === maxRepairAttempts) {
        // (e) max attempts reached
        attemptRecord.stopReason = 'max_attempts';
        repairAttempts.push(attemptRecord);
        // Still use the best result so far
        if (updatedAst) {
          lastAst = updatedAst;
          lastDiags = postRepairDiagnostics ?? currentDiagnostics;
          lastSource = updatedSource;
        }
        break;
      }

      // Continue to next attempt
      repairAttempts.push(attemptRecord);
      currentSource = updatedSource;
      currentDiagnostics = postRepairDiagnostics ?? currentDiagnostics;
      if (updatedAst) {
        lastAst = updatedAst;
        lastDiags = postRepairDiagnostics!;
        lastSource = updatedSource;
      }
    }

    const retryDurationMs = Math.round(performance.now() - retryStart);
    const finalErrors = lastDiags.summary.errors;
    const repairStatus = finalErrors === 0 && lastAst ? 'pass' : 'fail';

    stages.push({
      name: 'repair',
      status: repairStatus,
      durationMs: retryDurationMs,
      details: {
        attempts: repairAttempts.length,
        maxAttempts: maxRepairAttempts,
        finalErrors,
        stopReason: repairAttempts[repairAttempts.length - 1]?.stopReason,
      },
    });

    repairPayload = lastRepairPayload;
    effectiveAst = lastAst;
    effectiveDiagnostics = lastDiags;
    effectiveSource = lastAst ? lastSource : source;
  } else {
    // Single-attempt (default path — identical to prior A3c behavior)
    const {
      stage: repairStage,
      updatedSource,
      updatedAst,
      postRepairDiagnostics,
      repairResult: rp,
    } = await stageRepair(source, diagnostics, artifactDir, writeArtifacts, adapter);
    stages.push(repairStage);
    repairPayload = rp;

    effectiveAst = updatedAst ?? ast;
    effectiveDiagnostics = postRepairDiagnostics ?? diagnostics;
    effectiveSource = updatedAst ? updatedSource : source;
  }

  // If validation still fails after repair (or no AST), stop here
  if (!effectiveAst || effectiveDiagnostics.summary.errors > 0) {
    const result: LoopResult = {
      file,
      timestamp,
      stages,
      diagnostics,
      outputDir,
      artifactDir,
      determinismCheck: {
        sourceHash: hashSource(source),
        outputHashes: {},
        deterministic: true,
      },
      repairResult: repairPayload,
      ...(repairAttempts ? { repairAttempts } : {}),
    };
    if (writeArtifacts) writeFileSync(join(artifactDir, 'loop-result.json'), JSON.stringify(result, null, 2));
    return result;
  }

  // Stage 3: Transpile (use effective source/ast post-repair)
  const { stage: transpileStage, result: transpileResult } = stageTranspile(effectiveAst, effectiveSource);
  stages.push(transpileStage);

  if (!transpileResult) {
    const result: LoopResult = {
      file,
      timestamp,
      stages,
      diagnostics,
      outputDir,
      artifactDir,
      determinismCheck: {
        sourceHash: hashSource(source),
        outputHashes: {},
        deterministic: true,
      },
      repairResult: repairPayload,
      ...(repairAttempts ? { repairAttempts } : {}),
    };
    if (writeArtifacts) writeFileSync(join(artifactDir, 'loop-result.json'), JSON.stringify(result, null, 2));
    return result;
  }

  // Stage 4: Smoke test
  const smokeStage = stageSmoke(transpileResult.files);
  stages.push(smokeStage);

  // Stage 5: Determinism check
  const outputHashes = hashFiles(transpileResult.files);
  const { stage: deterStage, check: deterCheck } = stageDeterminism(effectiveAst, effectiveSource, outputHashes);
  stages.push(deterStage);

  // Deliver: Write output files
  for (const f of transpileResult.files) {
    const fullPath = join(outputDir, f.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, f.content);
  }

  // Log artifacts
  if (writeArtifacts) {
    writeFileSync(join(artifactDir, 'output-hashes.json'), JSON.stringify(outputHashes, null, 2));
    writeFileSync(join(artifactDir, 'stage-report.json'), JSON.stringify(stages, null, 2));
  }

  const loopResult: LoopResult = {
    file,
    timestamp,
    stages,
    diagnostics,
    transpileResult,
    outputDir,
    artifactDir,
    determinismCheck: deterCheck,
    repairResult: repairPayload,
    ...(repairAttempts ? { repairAttempts } : {}),
  };
  if (writeArtifacts) writeFileSync(join(artifactDir, 'loop-result.json'), JSON.stringify(loopResult, null, 2));

  return loopResult;
}

// ---- File-based entry point (CLI) ----

export async function runLoop(file: string, outputDir: string): Promise<LoopResult> {
  const source = readFileSync(file, 'utf-8');
  return runLoopFromSource(source, outputDir, { file });
}

// ---- CLI Formatter ----

export function formatLoopResult(result: LoopResult): string {
  const lines: string[] = [];
  lines.push(`  Loop result for ${result.file}`);
  lines.push(`  Artifacts: ${result.artifactDir}/\n`);

  for (const stage of result.stages) {
    const icon = stage.status === 'pass' ? '  PASS' : stage.status === 'fail' ? '  FAIL' : '  SKIP';
    lines.push(`  ${icon}  ${stage.name} (${stage.durationMs}ms)`);
  }

  lines.push('');

  if (result.repairResult?.attempted) {
    const r = result.repairResult;
    lines.push(`  Repair: ${r.status} (${r.appliedActions.length} applied, ${r.skippedActions.length} skipped)`);
    if (r.sourceChanged) {
      lines.push(`  Repaired source: ${r.repairedFile}`);
    }
    lines.push('');
  }

  // Show effective diagnostics: post-repair if repair was attempted, otherwise original
  const effectiveDiags = result.repairResult?.afterDiagnostics ?? result.diagnostics;
  if (effectiveDiags.summary.errors > 0) {
    lines.push(`  Diagnostics: ${effectiveDiags.summary.errors} errors, ${effectiveDiags.summary.warnings} warnings`);
    for (const d of effectiveDiags.diagnostics.filter(d => d.severity === 'error')) {
      lines.push(`    ${formatDiagnosticCLI(d).split('\n').join('\n    ')}`);
    }
    lines.push('');
  }

  if (result.transpileResult) {
    lines.push(`  Output: ${result.transpileResult.files.length} files, ${result.transpileResult.stats.outputLines} lines`);
  }

  lines.push(`  Deterministic: ${result.determinismCheck.deterministic ? 'yes' : 'NO'}`);

  return lines.join('\n');
}
