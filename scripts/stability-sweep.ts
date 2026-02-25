/**
 * AirEngine Stability Sweep (A8-prep)
 *
 * Runs all 7 showcase examples + 5 replay fixtures + optional live Claude runs
 * through the full loop pipeline. Produces a structured report for issue triage.
 *
 * Usage:
 *   npx tsx scripts/stability-sweep.ts [flags]
 *   npx tsx scripts/stability-sweep.ts --verbose
 *   npx tsx scripts/stability-sweep.ts --mode full --live-limit 2
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { runLoopFromSource } from '../src/cli/loop.js';
import type { LoopResult, LoopStage } from '../src/cli/loop.js';
import { createReplayAdapter, createClaudeAdapter, listReplayFixtures } from '../src/generator.js';
import type { GeneratorResult } from '../src/generator.js';

// ---- Types ----

export type SweepCaseSource = 'showcase' | 'replay' | 'live';
export type SweepOutcome =
  | 'success'
  | 'loop_failed_validation'
  | 'loop_failed_repair'
  | 'loop_failed_transpile'
  | 'loop_failed_smoke'
  | 'loop_failed_determinism'
  | 'generation_failed'
  | 'unexpected_error';

export interface SweepCase {
  id: string;
  source: SweepCaseSource;
  file?: string;
  fixture_id?: string;
  prompt?: string;
  complexity?: string;
  outcome: SweepOutcome;
  stages: { name: string; status: string; duration_ms: number }[];
  file_count?: number;
  deterministic?: boolean;
  duration_ms: number;
  error?: string;
}

export interface SweepSummary {
  total: number;
  success: number;
  failed: number;
  by_source: Record<SweepCaseSource, { total: number; success: number; failed: number }>;
  by_outcome: Record<string, number>;
}

export interface SweepIssue {
  id: string;
  severity: string;
  message: string;
}

export interface RunMetadata {
  airengine_version: string;
  node_version: string;
  platform: string;
  git_commit?: string;
}

export interface SweepReport {
  schema_version: '1.0';
  timestamp: string;
  mode: 'offline' | 'full';
  run_metadata: RunMetadata;
  cases: SweepCase[];
  summary: SweepSummary;
  issues: SweepIssue[];
  total_duration_ms: number;
}

// ---- Showcase manifest types ----

interface ShowcaseEntry {
  id: string;
  file: string;
  name: string;
  description: string;
  complexity: string;
  category: string;
  lines: number;
  blocks: string[];
  features: string[];
}

interface ShowcaseManifest {
  schema_version: string;
  description: string;
  examples: ShowcaseEntry[];
}

// ---- Exported Functions (testable) ----

/**
 * Classify the outcome of a loop result for sweep reporting.
 */
export function classifySweepOutcome(loopResult: LoopResult): SweepOutcome {
  const stages = loopResult.stages;

  // Check for repair compensating validate
  const repairStage = stages.find(s => s.name === 'repair');
  const repairPassed = repairStage?.status === 'pass';

  for (const stage of stages) {
    if (stage.status === 'fail') {
      // validate failed but repair passed → compensated
      if (stage.name === 'validate' && repairPassed) continue;

      const stageMap: Record<string, SweepOutcome> = {
        validate: 'loop_failed_validation',
        repair: 'loop_failed_repair',
        transpile: 'loop_failed_transpile',
        smoke: 'loop_failed_smoke',
        determinism: 'loop_failed_determinism',
      };
      return stageMap[stage.name] ?? 'unexpected_error';
    }
  }

  return 'success';
}

/**
 * Build a SweepCase from loop result and metadata.
 */
export function buildSweepCase(
  id: string,
  source: SweepCaseSource,
  loopResult: LoopResult,
  durationMs: number,
  extras?: {
    file?: string;
    fixture_id?: string;
    prompt?: string;
    complexity?: string;
    error?: string;
  },
): SweepCase {
  const outcome = classifySweepOutcome(loopResult);
  const fileCount = loopResult.transpileResult
    ? loopResult.transpileResult.files.length
    : undefined;

  return {
    id,
    source,
    ...(extras?.file ? { file: extras.file } : {}),
    ...(extras?.fixture_id ? { fixture_id: extras.fixture_id } : {}),
    ...(extras?.prompt ? { prompt: extras.prompt } : {}),
    ...(extras?.complexity ? { complexity: extras.complexity } : {}),
    outcome,
    stages: loopResult.stages.map(s => ({
      name: s.name,
      status: s.status,
      duration_ms: s.durationMs,
    })),
    ...(fileCount !== undefined ? { file_count: fileCount } : {}),
    deterministic: loopResult.determinismCheck?.deterministic ?? undefined,
    duration_ms: durationMs,
    ...(extras?.error ? { error: extras.error } : {}),
  };
}

/**
 * Build a SweepCase for a generation or unexpected failure (no loop result).
 */
function buildFailureCase(
  id: string,
  source: SweepCaseSource,
  outcome: SweepOutcome,
  durationMs: number,
  error: string,
  extras?: { file?: string; fixture_id?: string; prompt?: string; complexity?: string },
): SweepCase {
  return {
    id,
    source,
    ...(extras?.file ? { file: extras.file } : {}),
    ...(extras?.fixture_id ? { fixture_id: extras.fixture_id } : {}),
    ...(extras?.prompt ? { prompt: extras.prompt } : {}),
    ...(extras?.complexity ? { complexity: extras.complexity } : {}),
    outcome,
    stages: [],
    duration_ms: durationMs,
    error,
  };
}

/**
 * Aggregate sweep cases into a summary.
 */
export function aggregateSweepSummary(cases: SweepCase[]): SweepSummary {
  const total = cases.length;
  const success = cases.filter(c => c.outcome === 'success').length;
  const failed = total - success;

  // By source
  const sources: SweepCaseSource[] = ['showcase', 'replay', 'live'];
  const by_source: Record<SweepCaseSource, { total: number; success: number; failed: number }> =
    {} as any;
  for (const src of sources) {
    const srcCases = cases.filter(c => c.source === src);
    by_source[src] = {
      total: srcCases.length,
      success: srcCases.filter(c => c.outcome === 'success').length,
      failed: srcCases.filter(c => c.outcome !== 'success').length,
    };
  }

  // By outcome
  const by_outcome: Record<string, number> = {};
  for (const c of cases) {
    by_outcome[c.outcome] = (by_outcome[c.outcome] ?? 0) + 1;
  }

  return { total, success, failed, by_source, by_outcome };
}

/**
 * Build a complete sweep report.
 */
export function buildSweepReport(
  mode: 'offline' | 'full',
  cases: SweepCase[],
  issues: SweepIssue[],
  totalDurationMs: number,
  gitCommit?: string,
): SweepReport {
  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    mode,
    run_metadata: {
      airengine_version: '0.2.0',
      node_version: process.version,
      platform: process.platform,
      ...(gitCommit ? { git_commit: gitCommit } : {}),
    },
    cases,
    summary: aggregateSweepSummary(cases),
    issues,
    total_duration_ms: totalDurationMs,
  };
}

// ---- CLI Helpers ----

function getGitCommit(): string | undefined {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

interface CliArgs {
  mode: 'offline' | 'full';
  liveLimit: number;
  output: string;
  verbose: boolean;
  failFast: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    mode: 'offline',
    liveLimit: 2,
    output: 'artifacts/sweep/stability-sweep-report.json',
    verbose: false,
    failFast: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') result.mode = args[++i] as CliArgs['mode'];
    else if (arg === '--live-limit') result.liveLimit = parseInt(args[++i], 10);
    else if (arg === '--output') result.output = args[++i];
    else if (arg === '--verbose') result.verbose = true;
    else if (arg === '--fail-fast') result.failFast = true;
  }

  return result;
}

// ---- Main ----

async function main(): Promise<void> {
  const args = parseArgs();
  const totalStart = performance.now();
  const cases: SweepCase[] = [];
  const issues: SweepIssue[] = [];
  let stopped = false;

  // Resolve mode (full without API key → offline)
  let effectiveMode = args.mode;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (effectiveMode === 'full' && !apiKey) {
    console.log('WARNING: --mode full requested but ANTHROPIC_API_KEY not set. Downgrading to offline.\n');
    effectiveMode = 'offline';
  }

  console.log(`Stability Sweep — AirEngine v0.2.0`);
  console.log(`Mode: ${effectiveMode}${effectiveMode !== args.mode ? ` (requested: ${args.mode})` : ''}`);
  console.log();

  // ---- Phase 1: Showcase examples ----
  console.log('=== Phase 1: Showcase Examples ===\n');

  const manifestPath = resolve('examples/showcase-manifest.json');
  const manifest: ShowcaseManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  for (const example of manifest.examples) {
    if (stopped) break;
    const caseId = `showcase:${example.id}`;
    const caseStart = performance.now();
    console.log(`  [${caseId}] ${example.name} (${example.complexity})...`);

    try {
      const source = readFileSync(resolve(example.file), 'utf-8');
      const tmpDir = join(tmpdir(), `airengine-sweep-${example.id}-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      const loopResult = await runLoopFromSource(source, tmpDir, { writeArtifacts: false });
      const durationMs = Math.round(performance.now() - caseStart);

      const sweepCase = buildSweepCase(caseId, 'showcase', loopResult, durationMs, {
        file: example.file,
        complexity: example.complexity,
      });
      cases.push(sweepCase);

      const icon = sweepCase.outcome === 'success' ? 'PASS' : 'FAIL';
      if (args.verbose) {
        console.log(`    ${icon} (${durationMs}ms) — ${sweepCase.outcome}`);
        for (const s of sweepCase.stages) {
          console.log(`      ${s.name}: ${s.status} (${s.duration_ms}ms)`);
        }
      } else {
        console.log(`    ${icon} (${durationMs}ms)`);
      }

      if (sweepCase.outcome !== 'success') {
        issues.push({
          id: `SWEEP-${issues.length + 1}`,
          severity: 'P1',
          message: `${caseId} failed: ${sweepCase.outcome}`,
        });
        if (args.failFast) { stopped = true; }
      }

      // Clean up temp dir
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - caseStart);
      cases.push(buildFailureCase(caseId, 'showcase', 'unexpected_error', durationMs, err.message, {
        file: example.file,
        complexity: example.complexity,
      }));
      console.log(`    ERROR (${durationMs}ms) — ${err.message}`);
      issues.push({
        id: `SWEEP-${issues.length + 1}`,
        severity: 'P0',
        message: `${caseId} threw: ${err.message}`,
      });
      if (args.failFast) { stopped = true; }
    }
  }

  // ---- Phase 2: Replay fixtures ----
  console.log('\n=== Phase 2: Replay Fixtures ===\n');

  const replayAdapter = createReplayAdapter();
  const fixtures = listReplayFixtures();

  for (const fixture of fixtures) {
    if (stopped) break;
    const caseId = `replay:${fixture.fixtureId}`;
    const caseStart = performance.now();
    console.log(`  [${caseId}] ${fixture.description}...`);

    try {
      const genResult = await replayAdapter.generate(fixture.prompt, { fixtureId: fixture.fixtureId });

      if (!genResult.success || !genResult.source) {
        const durationMs = Math.round(performance.now() - caseStart);
        cases.push(buildFailureCase(caseId, 'replay', 'generation_failed', durationMs,
          genResult.error ?? 'No source generated', { fixture_id: fixture.fixtureId }));
        console.log(`    FAIL (${durationMs}ms) — generation_failed`);
        issues.push({
          id: `SWEEP-${issues.length + 1}`,
          severity: 'P1',
          message: `${caseId} generation failed: ${genResult.error}`,
        });
        if (args.failFast) { stopped = true; }
        continue;
      }

      const tmpDir = join(tmpdir(), `airengine-sweep-${fixture.fixtureId}-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      const loopResult = await runLoopFromSource(genResult.source, tmpDir, { writeArtifacts: false });
      const durationMs = Math.round(performance.now() - caseStart);

      const sweepCase = buildSweepCase(caseId, 'replay', loopResult, durationMs, {
        fixture_id: fixture.fixtureId,
      });
      cases.push(sweepCase);

      const icon = sweepCase.outcome === 'success' ? 'PASS' : 'FAIL';
      if (args.verbose) {
        console.log(`    ${icon} (${durationMs}ms) — ${sweepCase.outcome}`);
        for (const s of sweepCase.stages) {
          console.log(`      ${s.name}: ${s.status} (${s.duration_ms}ms)`);
        }
      } else {
        console.log(`    ${icon} (${durationMs}ms)`);
      }

      if (sweepCase.outcome !== 'success') {
        issues.push({
          id: `SWEEP-${issues.length + 1}`,
          severity: 'P1',
          message: `${caseId} failed: ${sweepCase.outcome}`,
        });
        if (args.failFast) { stopped = true; }
      }

      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - caseStart);
      cases.push(buildFailureCase(caseId, 'replay', 'unexpected_error', durationMs, err.message, {
        fixture_id: fixture.fixtureId,
      }));
      console.log(`    ERROR (${durationMs}ms) — ${err.message}`);
      issues.push({
        id: `SWEEP-${issues.length + 1}`,
        severity: 'P0',
        message: `${caseId} threw: ${err.message}`,
      });
      if (args.failFast) { stopped = true; }
    }
  }

  // ---- Phase 3: Live Claude (full mode only) ----
  if (effectiveMode === 'full' && apiKey && !stopped) {
    console.log('\n=== Phase 3: Live Claude Generation ===\n');

    const corpusPath = resolve('benchmarks/online-eval-corpus.json');
    const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8'));
    const simpleEntries = corpus.entries
      .filter((e: any) => e.complexity === 'simple')
      .slice(0, args.liveLimit);

    const claudeAdapter = createClaudeAdapter({ apiKey });

    for (const entry of simpleEntries) {
      if (stopped) break;
      const caseId = `live:${entry.id}`;
      const caseStart = performance.now();
      console.log(`  [${caseId}] ${entry.prompt.slice(0, 60)}...`);

      try {
        const genResult = await claudeAdapter.generate(entry.prompt);

        if (!genResult.success || !genResult.source) {
          const durationMs = Math.round(performance.now() - caseStart);
          cases.push(buildFailureCase(caseId, 'live', 'generation_failed', durationMs,
            genResult.error ?? 'No source generated', {
              prompt: entry.prompt,
              complexity: entry.complexity,
            }));
          console.log(`    FAIL (${durationMs}ms) — generation_failed`);
          issues.push({
            id: `SWEEP-${issues.length + 1}`,
            severity: 'P2',
            message: `${caseId} generation failed: ${genResult.error}`,
          });
          if (args.failFast) { stopped = true; }
          continue;
        }

        const tmpDir = join(tmpdir(), `airengine-sweep-live-${entry.id}-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });

        const loopResult = await runLoopFromSource(genResult.source, tmpDir, { writeArtifacts: false });
        const durationMs = Math.round(performance.now() - caseStart);

        const sweepCase = buildSweepCase(caseId, 'live', loopResult, durationMs, {
          prompt: entry.prompt,
          complexity: entry.complexity,
        });
        cases.push(sweepCase);

        const icon = sweepCase.outcome === 'success' ? 'PASS' : 'FAIL';
        if (args.verbose) {
          console.log(`    ${icon} (${durationMs}ms) — ${sweepCase.outcome}`);
          for (const s of sweepCase.stages) {
            console.log(`      ${s.name}: ${s.status} (${s.duration_ms}ms)`);
          }
        } else {
          console.log(`    ${icon} (${durationMs}ms)`);
        }

        if (sweepCase.outcome !== 'success') {
          issues.push({
            id: `SWEEP-${issues.length + 1}`,
            severity: 'P2',
            message: `${caseId} failed: ${sweepCase.outcome}`,
          });
          if (args.failFast) { stopped = true; }
        }

        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - caseStart);
        cases.push(buildFailureCase(caseId, 'live', 'unexpected_error', durationMs, err.message, {
          prompt: entry.prompt,
          complexity: entry.complexity,
        }));
        console.log(`    ERROR (${durationMs}ms) — ${err.message}`);
        issues.push({
          id: `SWEEP-${issues.length + 1}`,
          severity: 'P1',
          message: `${caseId} threw: ${err.message}`,
        });
        if (args.failFast) { stopped = true; }
      }
    }
  }

  // ---- Build report ----
  const totalDurationMs = Math.round(performance.now() - totalStart);
  const report = buildSweepReport(effectiveMode, cases, issues, totalDurationMs, getGitCommit());

  // Write report
  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary
  const s = report.summary;
  console.log('\n=== Stability Sweep Summary ===');
  console.log(`Total: ${s.total} cases — ${s.success} success, ${s.failed} failed`);
  console.log(`  Showcase: ${s.by_source.showcase.success}/${s.by_source.showcase.total}`);
  console.log(`  Replay:   ${s.by_source.replay.success}/${s.by_source.replay.total}`);
  if (s.by_source.live.total > 0) {
    console.log(`  Live:     ${s.by_source.live.success}/${s.by_source.live.total}`);
  }
  console.log(`Duration: ${totalDurationMs}ms`);

  if (issues.length > 0) {
    console.log(`\nIssues (${issues.length}):`);
    for (const issue of issues) {
      console.log(`  [${issue.severity}] ${issue.id}: ${issue.message}`);
    }
  } else {
    console.log('\nNo issues found.');
  }

  console.log(`\nReport: ${args.output}`);

  // Exit with failure if any cases failed
  process.exit(s.failed > 0 ? 1 : 0);
}

// Guard: only run when executed directly
const isDirectRun = process.argv[1]?.includes('stability-sweep');
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
