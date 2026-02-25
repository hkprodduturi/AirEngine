/**
 * AirEngine Unified Quality Gate Runner (A4c)
 *
 * Orchestrates offline and online quality gates with configurable modes.
 *
 * Modes:
 *   --mode offline  (default) Foundation check + eval-local + benchmark compare
 *   --mode online   Offline gates + eval-online + online compare
 *   --mode nightly  Same as online with verbose + artifact retention
 *   --mode auto     Offline always; online only if ANTHROPIC_API_KEY present
 *
 * Usage:
 *   npx tsx scripts/quality-gate.ts [flags]
 *   npx tsx scripts/quality-gate.ts --mode auto
 *   npx tsx scripts/quality-gate.ts --mode online --online-limit 2
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';

// ---- Types ----

export type GateMode = 'offline' | 'online' | 'nightly' | 'auto';

export interface GateStep {
  name: string;
  command: string;
  status: 'pass' | 'fail' | 'skip';
  exit_code: number | null;
  duration_ms: number;
  skip_reason?: string;
  details?: Record<string, unknown>;
}

export interface GateSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface QualityGateReport {
  schema_version: '1.0';
  timestamp: string;
  mode: GateMode;
  effective_mode: GateMode;
  run_metadata: {
    airengine_version: string;
    node_version: string;
    platform: string;
    git_commit?: string;
  };
  steps: GateStep[];
  offline_summary: GateSummary;
  online_summary: GateSummary | null;
  regression_summary: {
    online_compare_verdict?: 'pass' | 'fail' | 'skip';
    benchmark_compare_verdict?: 'pass' | 'fail' | 'skip';
  };
  verdict: 'pass' | 'fail';
  skipped_reasons: string[];
  artifact_paths: string[];
}

// ---- Exported Functions ----

/**
 * Execute a shell command as a gate step.
 */
export function runStep(name: string, command: string, timeoutMs = 300000): GateStep {
  const start = performance.now();
  try {
    execSync(command, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      name,
      command,
      status: 'pass',
      exit_code: 0,
      duration_ms: Math.round(performance.now() - start),
    };
  } catch (err: unknown) {
    const exitCode = (err as { status?: number }).status ?? 1;
    return {
      name,
      command,
      status: 'fail',
      exit_code: exitCode,
      duration_ms: Math.round(performance.now() - start),
    };
  }
}

/**
 * Create a skipped step.
 */
export function skipStep(name: string, command: string, reason: string): GateStep {
  return {
    name,
    command,
    status: 'skip',
    exit_code: null,
    duration_ms: 0,
    skip_reason: reason,
  };
}

/**
 * Compute a summary from a list of steps.
 */
export function summarizeSteps(steps: GateStep[]): GateSummary {
  return {
    total: steps.length,
    passed: steps.filter(s => s.status === 'pass').length,
    failed: steps.filter(s => s.status === 'fail').length,
    skipped: steps.filter(s => s.status === 'skip').length,
  };
}

/**
 * Determine the effective mode based on config and environment.
 */
export function resolveMode(requestedMode: GateMode, hasApiKey: boolean): GateMode {
  if (requestedMode === 'auto') {
    return hasApiKey ? 'online' : 'offline';
  }
  return requestedMode;
}

/**
 * Build the complete report from steps and context.
 */
export function buildGateReport(
  mode: GateMode,
  effectiveMode: GateMode,
  offlineSteps: GateStep[],
  onlineSteps: GateStep[],
  regressionSummary: QualityGateReport['regression_summary'],
  artifactPaths: string[],
  skippedReasons: string[],
  gitCommit?: string,
): QualityGateReport {
  const allSteps = [...offlineSteps, ...onlineSteps];
  const offlineSummary = summarizeSteps(offlineSteps);
  const onlineSummary = onlineSteps.length > 0 ? summarizeSteps(onlineSteps) : null;

  const anyFail = allSteps.some(s => s.status === 'fail');

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
    steps: allSteps,
    offline_summary: offlineSummary,
    online_summary: onlineSummary,
    regression_summary: regressionSummary,
    verdict: anyFail ? 'fail' : 'pass',
    skipped_reasons: skippedReasons,
    artifact_paths: artifactPaths,
  };
}

// ---- CLI ----

interface CliArgs {
  mode: GateMode;
  failFast: boolean;
  verbose: boolean;
  onlineLimit: number | null;
  onlineBaseline: string | null;
  benchmarkBaseline: string | null;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    mode: 'offline',
    failFast: false,
    verbose: false,
    onlineLimit: null,
    onlineBaseline: null,
    benchmarkBaseline: null,
    output: 'artifacts/gates/quality-gate-report.json',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') result.mode = args[++i] as GateMode;
    else if (arg === '--fail-fast') result.failFast = true;
    else if (arg === '--verbose') result.verbose = true;
    else if (arg === '--online-limit') result.onlineLimit = parseInt(args[++i], 10);
    else if (arg === '--online-baseline') result.onlineBaseline = args[++i];
    else if (arg === '--benchmark-baseline') result.benchmarkBaseline = args[++i];
    else if (arg === '--output') result.output = args[++i];
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
  const args = parseArgs();
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const effectiveMode = resolveMode(args.mode, hasApiKey);
  const includeOnline = effectiveMode === 'online' || effectiveMode === 'nightly';
  const verbose = args.verbose || effectiveMode === 'nightly';

  console.log(`Quality Gate Runner — AirEngine v0.2.0`);
  console.log(`Mode: ${args.mode}${args.mode !== effectiveMode ? ` (effective: ${effectiveMode})` : ''}`);
  console.log(`API key: ${hasApiKey ? 'present' : 'absent'}`);
  console.log();

  const offlineSteps: GateStep[] = [];
  const onlineSteps: GateStep[] = [];
  const skippedReasons: string[] = [];
  const artifactPaths: string[] = [];
  const regressionSummary: QualityGateReport['regression_summary'] = {};

  // ---- Offline Gates ----

  // 1. Foundation check
  console.log('  [offline] foundation-check...');
  const foundationStep = runStep(
    'foundation-check',
    'node --import tsx scripts/foundation-check.ts',
  );
  offlineSteps.push(foundationStep);
  console.log(`    ${foundationStep.status.toUpperCase()} (${foundationStep.duration_ms}ms)`);
  artifactPaths.push('artifacts/foundation/foundation-check-report.json');

  if (args.failFast && foundationStep.status === 'fail') {
    console.log('\n  FAIL FAST: foundation-check failed, stopping.');
  } else {
    // 2. Eval local
    console.log('  [offline] eval-local...');
    const evalLocalStep = runStep(
      'eval-local',
      'node --import tsx scripts/eval-local.ts',
    );
    offlineSteps.push(evalLocalStep);
    console.log(`    ${evalLocalStep.status.toUpperCase()} (${evalLocalStep.duration_ms}ms)`);
    artifactPaths.push('artifacts/eval/local-eval-report.json');

    if (args.failFast && evalLocalStep.status === 'fail') {
      console.log('\n  FAIL FAST: eval-local failed, stopping.');
    } else {
      // 3. Benchmark compare (if baseline exists)
      const benchBaseline = args.benchmarkBaseline ?? 'artifacts/eval/benchmark-baseline.json';
      if (existsSync(benchBaseline)) {
        console.log('  [offline] benchmark-compare...');
        const benchStep = runStep(
          'benchmark-compare',
          `node --import tsx scripts/benchmark-compare.ts ${benchBaseline} ${benchBaseline}`,
        );
        offlineSteps.push(benchStep);
        regressionSummary.benchmark_compare_verdict = benchStep.status === 'pass' ? 'pass' : 'fail';
        console.log(`    ${benchStep.status.toUpperCase()} (${benchStep.duration_ms}ms)`);
        artifactPaths.push('artifacts/benchmarks/benchmark-compare.json');
      } else {
        const reason = `benchmark baseline not found at ${benchBaseline}`;
        offlineSteps.push(skipStep('benchmark-compare', '', reason));
        regressionSummary.benchmark_compare_verdict = 'skip';
        skippedReasons.push(reason);
        console.log(`  [offline] benchmark-compare... SKIP (${reason})`);
      }
    }
  }

  // ---- Online Gates ----

  if (includeOnline) {
    if (!hasApiKey) {
      // Online mode requested but no key
      if (args.mode === 'auto') {
        const reason = 'ANTHROPIC_API_KEY not set (auto mode: online skipped)';
        skippedReasons.push(reason);
        onlineSteps.push(skipStep('eval-online', '', reason));
        regressionSummary.online_compare_verdict = 'skip';
        console.log(`\n  [online] eval-online... SKIP (${reason})`);
      } else {
        // Explicit online/nightly mode without key = fail
        console.log('\n  [online] eval-online... FAIL (ANTHROPIC_API_KEY not set)');
        onlineSteps.push({
          name: 'eval-online',
          command: '',
          status: 'fail',
          exit_code: 1,
          duration_ms: 0,
          details: { error: 'ANTHROPIC_API_KEY not set' },
        });
        regressionSummary.online_compare_verdict = 'skip';
      }
    } else {
      // Run online eval
      const limitFlag = args.onlineLimit ? ` --limit ${args.onlineLimit}` : '';
      const verboseFlag = verbose ? ' --verbose' : '';
      const onlineCmd = `node --import tsx scripts/eval-online.ts${limitFlag}${verboseFlag}`;
      console.log(`\n  [online] eval-online${limitFlag}...`);
      const onlineStep = runStep('eval-online', onlineCmd, 600000);
      onlineSteps.push(onlineStep);
      console.log(`    ${onlineStep.status.toUpperCase()} (${onlineStep.duration_ms}ms)`);
      artifactPaths.push('artifacts/eval/online-eval-report.json');

      if (onlineStep.status === 'pass' || existsSync('artifacts/eval/online-eval-report.json')) {
        // Online compare (if baseline exists)
        const onlineBaseline = args.onlineBaseline ?? 'artifacts/eval/online-eval-baseline.json';
        if (existsSync(onlineBaseline)) {
          console.log('  [online] eval-online-compare...');
          const compareStep = runStep(
            'eval-online-compare',
            `node --import tsx scripts/eval-online-compare.ts ${onlineBaseline} artifacts/eval/online-eval-report.json`,
          );
          onlineSteps.push(compareStep);
          regressionSummary.online_compare_verdict = compareStep.status === 'pass' ? 'pass' : 'fail';
          console.log(`    ${compareStep.status.toUpperCase()} (${compareStep.duration_ms}ms)`);
          artifactPaths.push('artifacts/eval/online-eval-compare.json');
        } else {
          const reason = `online baseline not found at ${onlineBaseline}`;
          onlineSteps.push(skipStep('eval-online-compare', '', reason));
          regressionSummary.online_compare_verdict = 'skip';
          skippedReasons.push(reason);
          console.log(`  [online] eval-online-compare... SKIP (${reason})`);
        }
      } else {
        regressionSummary.online_compare_verdict = 'skip';
      }
    }
  } else if (args.mode !== 'offline') {
    // Auto mode resolved to offline
    const reason = 'ANTHROPIC_API_KEY not set (auto mode: online skipped)';
    skippedReasons.push(reason);
  }

  // ---- Build Report ----

  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });

  const report = buildGateReport(
    args.mode,
    effectiveMode,
    offlineSteps,
    onlineSteps,
    regressionSummary,
    artifactPaths,
    skippedReasons,
    getGitCommit(),
  );

  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary
  const os = report.offline_summary;
  console.log();
  console.log('=== Quality Gate Summary ===');
  console.log(`Verdict: ${report.verdict.toUpperCase()}`);
  console.log(`Offline: ${os.passed}/${os.total} passed, ${os.failed} failed, ${os.skipped} skipped`);
  if (report.online_summary) {
    const ons = report.online_summary;
    console.log(`Online:  ${ons.passed}/${ons.total} passed, ${ons.failed} failed, ${ons.skipped} skipped`);
  }
  if (skippedReasons.length > 0) {
    console.log('Skipped:');
    for (const r of skippedReasons) console.log(`  - ${r}`);
  }
  console.log(`Report: ${args.output}`);

  process.exit(report.verdict === 'pass' ? 0 : 1);
}

// Guard: only run when executed directly
const isDirectRun = process.argv[1]?.includes('quality-gate');
if (isDirectRun) {
  main();
}
