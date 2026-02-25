/**
 * AirEngine Alpha RC Rehearsal Runner (A8)
 *
 * Orchestrates a full release rehearsal: doctor → offline gates → canonical demo →
 * online eval → compare → baseline freeze. Produces a go/no-go report.
 *
 * Modes:
 *   --mode offline  (default) Doctor + offline gates + canonical demo (replay)
 *   --mode full     Offline + online eval + compare/baseline freeze
 *
 * Usage:
 *   npx tsx scripts/release-alpha-rehearsal.ts
 *   npx tsx scripts/release-alpha-rehearsal.ts --mode full --online-limit 3
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import {
  runStep,
  skipStep,
  summarizeSteps,
} from './quality-gate.js';
import type { GateStep, GateSummary } from './quality-gate.js';

// ---- Types ----

export type RehearsalMode = 'offline' | 'full';

export interface StageSummaries {
  doctor: GateSummary;
  offline_gates: GateSummary;
  canonical_demo: GateSummary;
  online_eval: GateSummary | null;
  online_compare: GateSummary | null;
  baseline_freeze: GateSummary | null;
}

export interface BaselineProvenance {
  frozen_at: string;
  git_commit?: string;
  source_report: string;
}

export interface BaselineValidation {
  path: string;
  exists: boolean;
  valid: boolean;
  schema_version?: string;
  provenance?: BaselineProvenance;
  error?: string;
}

export interface RunMetadata {
  airengine_version: string;
  node_version: string;
  platform: string;
  git_commit?: string;
}

export interface RehearsalReport {
  schema_version: '1.0';
  timestamp: string;
  mode: RehearsalMode;
  effective_mode: RehearsalMode;
  run_metadata: RunMetadata;
  steps: GateStep[];
  stage_summaries: StageSummaries;
  baseline: BaselineValidation | null;
  verdict: 'pass' | 'fail';
  go_no_go: 'GO' | 'NO-GO';
  skipped_reasons: string[];
  artifact_paths: string[];
  total_duration_ms: number;
}

// ---- Exported Functions ----

/**
 * Resolve rehearsal mode: full without API key downgrades to offline.
 */
export function resolveRehearsalMode(
  requested: RehearsalMode,
  hasApiKey: boolean,
): RehearsalMode {
  if (requested === 'full' && !hasApiKey) return 'offline';
  return requested;
}

/**
 * Aggregate steps into 6-category stage summaries.
 */
export function aggregateSteps(steps: GateStep[], mode: RehearsalMode): StageSummaries {
  const byCategory = (prefix: string) => steps.filter(s => s.name.startsWith(prefix));

  const doctorSteps = steps.filter(s => s.name === 'doctor');
  const offlineSteps = steps.filter(s => s.name === 'offline-gates');
  const canonicalSteps = steps.filter(s => s.name === 'canonical-demo');
  const onlineEvalSteps = steps.filter(s => s.name === 'online-eval');
  const onlineCompareSteps = steps.filter(s => s.name === 'online-compare');
  const freezeSteps = steps.filter(s => s.name === 'baseline-freeze');

  return {
    doctor: summarizeSteps(doctorSteps),
    offline_gates: summarizeSteps(offlineSteps),
    canonical_demo: summarizeSteps(canonicalSteps),
    online_eval: mode === 'full' ? summarizeSteps(onlineEvalSteps) : null,
    online_compare: mode === 'full' ? summarizeSteps(onlineCompareSteps) : null,
    baseline_freeze: mode === 'full' ? summarizeSteps(freezeSteps) : null,
  };
}

/**
 * Compute pass/fail verdict from steps and mode.
 * Skipped steps do not cause failure. In offline mode, online steps are ignored.
 */
export function computeVerdict(steps: GateStep[], mode: RehearsalMode): 'pass' | 'fail' {
  const relevant = mode === 'offline'
    ? steps.filter(s => !['online-eval', 'online-compare', 'baseline-freeze'].includes(s.name))
    : steps;

  return relevant.some(s => s.status === 'fail') ? 'fail' : 'pass';
}

/**
 * Validate a baseline file exists and is structurally sound.
 */
export function validateBaseline(path: string): BaselineValidation {
  if (!existsSync(path)) {
    return { path, exists: false, valid: false, error: 'File not found' };
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);

    if (!data || typeof data !== 'object') {
      return { path, exists: true, valid: false, error: 'Not a JSON object' };
    }

    if (data.schema_version !== '1.0') {
      return {
        path,
        exists: true,
        valid: false,
        schema_version: data.schema_version,
        error: `Unsupported schema_version: ${data.schema_version}`,
      };
    }

    if (!data.metrics || typeof data.metrics.prompt_to_running_app_success_rate !== 'number') {
      return {
        path,
        exists: true,
        valid: false,
        schema_version: data.schema_version,
        error: 'Missing metrics.prompt_to_running_app_success_rate',
      };
    }

    const provenance = data._provenance as BaselineProvenance | undefined;

    return {
      path,
      exists: true,
      valid: true,
      schema_version: data.schema_version,
      ...(provenance ? { provenance } : {}),
    };
  } catch (err: unknown) {
    return {
      path,
      exists: true,
      valid: false,
      error: `Parse error: ${(err as Error).message}`,
    };
  }
}

/**
 * Build the complete rehearsal report.
 */
export function buildRehearsalReport(
  mode: RehearsalMode,
  effectiveMode: RehearsalMode,
  steps: GateStep[],
  baseline: BaselineValidation | null,
  artifactPaths: string[],
  skippedReasons: string[],
  totalDurationMs: number,
  gitCommit?: string,
): RehearsalReport {
  const verdict = computeVerdict(steps, effectiveMode);
  const stageSummaries = aggregateSteps(steps, effectiveMode);

  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    mode,
    effective_mode: effectiveMode,
    run_metadata: {
      airengine_version: '0.2.0',
      node_version: process.version,
      platform: process.platform,
      ...(gitCommit ? { git_commit: gitCommit } : {}),
    },
    steps,
    stage_summaries: stageSummaries,
    baseline,
    verdict,
    go_no_go: verdict === 'pass' ? 'GO' : 'NO-GO',
    skipped_reasons: skippedReasons,
    artifact_paths: artifactPaths,
    total_duration_ms: totalDurationMs,
  };
}

// ---- CLI ----

interface CliArgs {
  mode: RehearsalMode;
  onlineLimit: number | null;
  repairMode: string;
  output: string;
  verbose: boolean;
  failFast: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    mode: 'offline',
    onlineLimit: null,
    repairMode: 'deterministic',
    output: 'artifacts/rehearsal/alpha-rehearsal-report.json',
    verbose: false,
    failFast: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') result.mode = args[++i] as RehearsalMode;
    else if (arg === '--online-limit') result.onlineLimit = parseInt(args[++i], 10);
    else if (arg === '--repair-mode') result.repairMode = args[++i];
    else if (arg === '--output') result.output = args[++i];
    else if (arg === '--verbose') result.verbose = true;
    else if (arg === '--fail-fast') result.failFast = true;
  }

  return result;
}

function getGitCommit(): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

function main(): void {
  const startTime = performance.now();
  const args = parseArgs();
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const effectiveMode = resolveRehearsalMode(args.mode, hasApiKey);
  const baselinePath = 'benchmarks/online-eval-baseline-alpha.json';

  console.log('AirEngine Alpha RC Rehearsal — Release Readiness Check');
  console.log(`Mode: ${args.mode}${args.mode !== effectiveMode ? ` (effective: ${effectiveMode})` : ''}`);
  console.log(`API key: ${hasApiKey ? 'present' : 'absent'}`);
  console.log();

  const steps: GateStep[] = [];
  const skippedReasons: string[] = [];
  const artifactPaths: string[] = [];

  if (args.mode === 'full' && !hasApiKey) {
    skippedReasons.push('ANTHROPIC_API_KEY not set — downgraded from full to offline');
  }

  // ---- Stage 1: Doctor ----

  console.log('  [1/6] doctor...');
  const doctorStep = runStep(
    'doctor',
    'node --import tsx scripts/doctor.ts',
  );
  steps.push(doctorStep);
  console.log(`    ${doctorStep.status.toUpperCase()} (${doctorStep.duration_ms}ms)`);
  artifactPaths.push('artifacts/doctor/doctor-report.json');

  if (args.failFast && doctorStep.status === 'fail') {
    console.log('\n  FAIL FAST: doctor failed, stopping.');
    finalize(args, effectiveMode, steps, null, artifactPaths, skippedReasons, startTime);
    return;
  }

  // ---- Stage 2: Offline Gates ----

  console.log('  [2/6] offline-gates...');
  const offlineStep = runStep(
    'offline-gates',
    'node --import tsx scripts/quality-gate.ts --mode offline',
  );
  steps.push(offlineStep);
  console.log(`    ${offlineStep.status.toUpperCase()} (${offlineStep.duration_ms}ms)`);
  artifactPaths.push('artifacts/gates/quality-gate-report.json');

  if (args.failFast && offlineStep.status === 'fail') {
    console.log('\n  FAIL FAST: offline-gates failed, stopping.');
    finalize(args, effectiveMode, steps, null, artifactPaths, skippedReasons, startTime);
    return;
  }

  // ---- Stage 3: Canonical Demo ----

  console.log('  [3/6] canonical-demo...');
  const canonicalStep = runStep(
    'canonical-demo',
    'node --import tsx scripts/demo-live-canonical.ts --adapter replay',
  );
  steps.push(canonicalStep);
  console.log(`    ${canonicalStep.status.toUpperCase()} (${canonicalStep.duration_ms}ms)`);
  artifactPaths.push('artifacts/demo/canonical-live-demo-report.json');

  if (args.failFast && canonicalStep.status === 'fail') {
    console.log('\n  FAIL FAST: canonical-demo failed, stopping.');
    finalize(args, effectiveMode, steps, null, artifactPaths, skippedReasons, startTime);
    return;
  }

  // ---- Stages 4-6: Online (full mode only) ----

  let baseline: BaselineValidation | null = null;

  if (effectiveMode === 'full') {
    // Stage 4: Online Eval
    const limitFlag = args.onlineLimit ? ` --limit ${args.onlineLimit}` : '';
    const verboseFlag = args.verbose ? ' --verbose' : '';
    console.log(`  [4/6] online-eval${limitFlag}...`);
    const onlineEvalStep = runStep(
      'online-eval',
      `node --import tsx scripts/eval-online.ts${limitFlag}${verboseFlag}`,
      600000,
    );
    steps.push(onlineEvalStep);
    console.log(`    ${onlineEvalStep.status.toUpperCase()} (${onlineEvalStep.duration_ms}ms)`);
    artifactPaths.push('artifacts/eval/online-eval-report.json');

    if (args.failFast && onlineEvalStep.status === 'fail') {
      console.log('\n  FAIL FAST: online-eval failed, stopping.');
      finalize(args, effectiveMode, steps, null, artifactPaths, skippedReasons, startTime);
      return;
    }

    // Validate baseline
    baseline = validateBaseline(baselinePath);

    if (onlineEvalStep.status === 'pass') {
      if (baseline.valid) {
        // Stage 5: Online Compare
        console.log('  [5/6] online-compare...');
        const compareStep = runStep(
          'online-compare',
          `node --import tsx scripts/eval-online-compare.ts ${baselinePath} artifacts/eval/online-eval-report.json`,
        );
        steps.push(compareStep);
        console.log(`    ${compareStep.status.toUpperCase()} (${compareStep.duration_ms}ms)`);
        artifactPaths.push('artifacts/eval/online-eval-compare.json');

        // Stage 6: Skip freeze (baseline exists)
        const freezeReason = 'Baseline already exists and is valid — no freeze needed';
        steps.push(skipStep('baseline-freeze', '', freezeReason));
        skippedReasons.push(freezeReason);
        console.log(`  [6/6] baseline-freeze... SKIP (${freezeReason})`);
      } else if (!baseline.exists) {
        // Stage 5: Skip compare (no baseline)
        const compareReason = 'No baseline to compare against — first run';
        steps.push(skipStep('online-compare', '', compareReason));
        skippedReasons.push(compareReason);
        console.log('  [5/6] online-compare... SKIP (first run, no baseline)');

        // Stage 6: Baseline Freeze
        console.log('  [6/6] baseline-freeze...');
        try {
          const evalReport = JSON.parse(
            readFileSync('artifacts/eval/online-eval-report.json', 'utf-8'),
          );
          const gitCommit = getGitCommit();
          evalReport._provenance = {
            frozen_at: new Date().toISOString(),
            ...(gitCommit ? { git_commit: gitCommit } : {}),
            source_report: 'artifacts/eval/online-eval-report.json',
          };
          mkdirSync(dirname(baselinePath), { recursive: true });
          writeFileSync(baselinePath, JSON.stringify(evalReport, null, 2));
          steps.push({
            name: 'baseline-freeze',
            command: `copy eval report → ${baselinePath}`,
            status: 'pass',
            exit_code: 0,
            duration_ms: 0,
          });
          console.log('    PASS (baseline frozen)');
          artifactPaths.push(baselinePath);
          // Re-validate after freeze
          baseline = validateBaseline(baselinePath);
        } catch (err: unknown) {
          steps.push({
            name: 'baseline-freeze',
            command: `copy eval report → ${baselinePath}`,
            status: 'fail',
            exit_code: 1,
            duration_ms: 0,
            details: { error: (err as Error).message },
          });
          console.log(`    FAIL (${(err as Error).message})`);
        }
      } else {
        // Baseline exists but invalid
        const compareReason = `Baseline invalid: ${baseline.error}`;
        steps.push(skipStep('online-compare', '', compareReason));
        skippedReasons.push(compareReason);
        console.log(`  [5/6] online-compare... SKIP (${compareReason})`);

        const freezeReason = 'Baseline exists but is invalid — manual fix required';
        steps.push(skipStep('baseline-freeze', '', freezeReason));
        skippedReasons.push(freezeReason);
        console.log(`  [6/6] baseline-freeze... SKIP (${freezeReason})`);
      }
    } else {
      // Online eval failed — skip compare and freeze
      const compareReason = 'Online eval did not pass — compare skipped';
      steps.push(skipStep('online-compare', '', compareReason));
      skippedReasons.push(compareReason);
      console.log('  [5/6] online-compare... SKIP (eval failed)');

      const freezeReason = 'Online eval did not pass — freeze skipped';
      steps.push(skipStep('baseline-freeze', '', freezeReason));
      skippedReasons.push(freezeReason);
      console.log('  [6/6] baseline-freeze... SKIP (eval failed)');
    }
  } else {
    // Offline mode — skip stages 4-6
    const offlineReason = 'Offline mode — online stages skipped';
    steps.push(skipStep('online-eval', '', offlineReason));
    steps.push(skipStep('online-compare', '', offlineReason));
    steps.push(skipStep('baseline-freeze', '', offlineReason));
    skippedReasons.push(offlineReason);
    console.log('  [4/6] online-eval... SKIP (offline mode)');
    console.log('  [5/6] online-compare... SKIP (offline mode)');
    console.log('  [6/6] baseline-freeze... SKIP (offline mode)');
  }

  finalize(args, effectiveMode, steps, baseline, artifactPaths, skippedReasons, startTime);
}

function finalize(
  args: CliArgs,
  effectiveMode: RehearsalMode,
  steps: GateStep[],
  baseline: BaselineValidation | null,
  artifactPaths: string[],
  skippedReasons: string[],
  startTime: number,
): void {
  const totalDurationMs = Math.round(performance.now() - startTime);
  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });

  const report = buildRehearsalReport(
    args.mode,
    effectiveMode,
    steps,
    baseline,
    artifactPaths,
    skippedReasons,
    totalDurationMs,
    getGitCommit(),
  );

  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log();
  console.log('=== Alpha RC Rehearsal Summary ===');
  console.log(`Verdict:  ${report.verdict.toUpperCase()}`);
  console.log(`Go/No-Go: ${report.go_no_go}`);

  const stageNames = ['doctor', 'offline_gates', 'canonical_demo', 'online_eval', 'online_compare', 'baseline_freeze'] as const;
  for (const name of stageNames) {
    const summary = report.stage_summaries[name];
    if (summary) {
      console.log(`  ${name}: ${summary.passed}/${summary.total} pass, ${summary.failed} fail, ${summary.skipped} skip`);
    } else {
      console.log(`  ${name}: (not run)`);
    }
  }

  if (skippedReasons.length > 0) {
    console.log('Skipped:');
    for (const r of skippedReasons) console.log(`  - ${r}`);
  }
  console.log(`Duration: ${totalDurationMs}ms`);
  console.log(`Report: ${args.output}`);

  process.exit(report.verdict === 'pass' ? 0 : 1);
}

// Guard: only run when executed directly
const isDirectRun = process.argv[1]?.includes('release-alpha-rehearsal');
if (isDirectRun) {
  main();
}
