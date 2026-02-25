/**
 * AirEngine Online Eval Harness (A6c)
 *
 * Runs a benchmark corpus through the real Claude pipeline
 * (generate → loop) and records success rate, retries, timing,
 * and token metrics.
 *
 * Usage:
 *   npx tsx scripts/eval-online.ts [flags]
 *   npx tsx scripts/eval-online.ts --dry-run
 *   npx tsx scripts/eval-online.ts --limit 2 --verbose
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { createClaudeAdapter } from '../src/generator.js';
import type { GeneratorResult, GeneratorAdapter } from '../src/generator.js';
import { runLoopFromSource } from '../src/cli/loop.js';
import type { LoopResult, LoopStage } from '../src/cli/loop.js';

// ---- Outcome Categories ----

export type OutcomeCategory =
  | 'success_running_app'
  | 'generation_failed_auth'
  | 'generation_failed_provider'
  | 'generation_failed_invalid_air'
  | 'loop_failed_validation'
  | 'loop_failed_repair'
  | 'loop_failed_transpile'
  | 'loop_failed_smoke'
  | 'loop_failed_determinism'
  | 'unexpected_error';

// ---- Corpus Types ----

export interface CorpusEntry {
  id: string;
  prompt: string;
  category: string;
  complexity: 'simple' | 'medium' | 'complex';
  tags?: string[];
}

export interface Corpus {
  schema_version: string;
  corpus_id: string;
  entries: CorpusEntry[];
}

// ---- Result Types ----

export interface GenerationInfo {
  success: boolean;
  duration_ms: number;
  model?: string;
  attempts?: number;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
}

export interface LoopInfo {
  stages: Array<{ name: string; status: string; duration_ms: number }>;
  repair_attempts?: number;
  deterministic?: boolean;
  file_count?: number;
  output_lines?: number;
}

export interface CaseResult {
  id: string;
  prompt_hash: string;
  outcome: OutcomeCategory;
  generation: GenerationInfo;
  loop?: LoopInfo;
  total_duration_ms: number;
  error?: string;
}

export interface TimingMetrics {
  avg_total_ms: number;
  p50_total_ms: number;
  p95_total_ms: number;
  avg_generation_ms: number;
  avg_loop_ms: number;
}

export interface TokenMetrics {
  total_input: number;
  total_output: number;
  avg_input: number;
  avg_output: number;
}

export interface RetryMetrics {
  avg_generation_attempts: number;
  avg_repair_attempts: number;
}

export interface AggregateMetrics {
  total_cases: number;
  completed_cases: number;
  success_count: number;
  prompt_to_air_success_rate: number;
  prompt_to_running_app_success_rate: number;
  timing: TimingMetrics;
  tokens: TokenMetrics;
  retries: RetryMetrics;
  failure_breakdown: Record<OutcomeCategory, number>;
}

export interface OnlineEvalReport {
  schema_version: '1.0';
  timestamp: string;
  run_metadata: {
    airengine_version: string;
    node_version: string;
    platform: string;
    git_commit?: string;
  };
  config: {
    generator_model: string;
    repair_mode: string;
    max_repair_attempts: number;
    timeout_ms: number;
    provider_retries: number;
    repair_model?: string;
    repair_provider_retries?: number;
  };
  corpus: {
    path: string;
    total_entries: number;
    limit_applied: number | null;
    corpus_id: string;
  };
  cases: CaseResult[];
  metrics: AggregateMetrics;
  artifact_dir: string;
}

// ---- Exported Functions (testable) ----

/**
 * Load and validate a corpus file. Optionally apply a limit.
 */
export function loadCorpus(path: string, limit?: number): { corpus: Corpus; entries: CorpusEntry[] } {
  const raw = readFileSync(path, 'utf-8');
  const data = JSON.parse(raw);

  // Validate top-level shape
  if (!data || typeof data !== 'object') throw new Error('Corpus must be a JSON object');
  if (typeof data.schema_version !== 'string') throw new Error('Corpus missing schema_version');
  if (typeof data.corpus_id !== 'string') throw new Error('Corpus missing corpus_id');
  if (!Array.isArray(data.entries)) throw new Error('Corpus missing entries array');

  // Validate each entry
  for (const entry of data.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Corpus entry must be an object');
    if (typeof entry.id !== 'string') throw new Error(`Corpus entry missing id`);
    if (typeof entry.prompt !== 'string') throw new Error(`Corpus entry "${entry.id}" missing prompt`);
    if (typeof entry.category !== 'string') throw new Error(`Corpus entry "${entry.id}" missing category`);
    if (!['simple', 'medium', 'complex'].includes(entry.complexity)) {
      throw new Error(`Corpus entry "${entry.id}" has invalid complexity: ${entry.complexity}`);
    }
  }

  const corpus = data as Corpus;
  const entries = limit ? corpus.entries.slice(0, limit) : corpus.entries;
  return { corpus, entries };
}

/**
 * Classify the outcome of a generation + loop attempt.
 */
export function classifyOutcome(
  genResult?: GeneratorResult,
  loopResult?: LoopResult,
  error?: Error | string,
): OutcomeCategory {
  // Unexpected error takes priority
  if (error) return 'unexpected_error';

  // Generation failures
  if (!genResult || !genResult.success) {
    const errMsg = genResult?.error ?? '';
    if (errMsg.includes('Authentication') || errMsg.includes('401') || errMsg.includes('403')) {
      return 'generation_failed_auth';
    }
    if (errMsg.includes('HTTP') || errMsg.includes('timed out') || errMsg.includes('429') || /\b5\d{2}\b/.test(errMsg)) {
      return 'generation_failed_provider';
    }
    return 'generation_failed_invalid_air';
  }

  // Generation succeeded but no loop result (source didn't parse for loop)
  if (!loopResult) return 'generation_failed_invalid_air';

  // Check loop stages
  const stages = loopResult.stages;

  // Check for repair compensating validate
  const validateStage = stages.find(s => s.name === 'validate');
  const repairStage = stages.find(s => s.name === 'repair');
  const validateFailed = validateStage?.status === 'fail';
  const repairPassed = repairStage?.status === 'pass';

  // Check stages after repair compensation
  for (const stage of stages) {
    if (stage.status === 'fail') {
      // If validate failed but repair passed, validate is compensated
      if (stage.name === 'validate' && repairPassed) continue;

      // Map stage name to outcome
      const stageMap: Record<string, OutcomeCategory> = {
        validate: 'loop_failed_validation',
        repair: 'loop_failed_repair',
        transpile: 'loop_failed_transpile',
        smoke: 'loop_failed_smoke',
        determinism: 'loop_failed_determinism',
      };
      return stageMap[stage.name] ?? 'unexpected_error';
    }
  }

  return 'success_running_app';
}

/**
 * Compute aggregate metrics from case results.
 */
export function computeMetrics(cases: CaseResult[]): AggregateMetrics {
  const allOutcomes: OutcomeCategory[] = [
    'success_running_app',
    'generation_failed_auth',
    'generation_failed_provider',
    'generation_failed_invalid_air',
    'loop_failed_validation',
    'loop_failed_repair',
    'loop_failed_transpile',
    'loop_failed_smoke',
    'loop_failed_determinism',
    'unexpected_error',
  ];

  const total = cases.length;
  const completed = cases.filter(c => c.outcome !== 'unexpected_error').length;
  const successCount = cases.filter(c => c.outcome === 'success_running_app').length;

  // Cases where generation produced valid .air (i.e. loop was attempted)
  const genSuccessCount = cases.filter(c => c.generation.success && c.loop).length;

  const promptToAirRate = total > 0 ? genSuccessCount / total : 0;
  const promptToRunningRate = total > 0 ? successCount / total : 0;

  // Timing
  const totalDurations = cases.map(c => c.total_duration_ms);
  const genDurations = cases.map(c => c.generation.duration_ms);
  const loopDurations = cases.filter(c => c.loop).map(c => {
    const loopStages = c.loop!.stages;
    return loopStages.reduce((sum, s) => sum + s.duration_ms, 0);
  });

  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const percentile = (arr: number[], p: number) => {
    if (arr.length < 2) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
    return sorted[idx];
  };

  // Tokens
  const inputTokens = cases.map(c => c.generation.input_tokens ?? 0);
  const outputTokens = cases.map(c => c.generation.output_tokens ?? 0);
  const totalInput = inputTokens.reduce((a, b) => a + b, 0);
  const totalOutput = outputTokens.reduce((a, b) => a + b, 0);

  // Retries
  const genAttempts = cases.map(c => c.generation.attempts ?? 1);
  const repairAttempts = cases.filter(c => c.loop).map(c => c.loop!.repair_attempts ?? 0);

  // Failure breakdown
  const breakdown: Record<OutcomeCategory, number> = {} as Record<OutcomeCategory, number>;
  for (const oc of allOutcomes) breakdown[oc] = 0;
  for (const c of cases) breakdown[c.outcome]++;

  return {
    total_cases: total,
    completed_cases: completed,
    success_count: successCount,
    prompt_to_air_success_rate: Math.round(promptToAirRate * 1000) / 1000,
    prompt_to_running_app_success_rate: Math.round(promptToRunningRate * 1000) / 1000,
    timing: {
      avg_total_ms: avg(totalDurations),
      p50_total_ms: percentile(totalDurations, 0.5),
      p95_total_ms: percentile(totalDurations, 0.95),
      avg_generation_ms: avg(genDurations),
      avg_loop_ms: avg(loopDurations),
    },
    tokens: {
      total_input: totalInput,
      total_output: totalOutput,
      avg_input: avg(inputTokens),
      avg_output: avg(outputTokens),
    },
    retries: {
      avg_generation_attempts: genAttempts.length > 0
        ? Math.round((genAttempts.reduce((a, b) => a + b, 0) / genAttempts.length) * 100) / 100
        : 0,
      avg_repair_attempts: repairAttempts.length > 0
        ? Math.round((repairAttempts.reduce((a, b) => a + b, 0) / repairAttempts.length) * 100) / 100
        : 0,
    },
    failure_breakdown: breakdown,
  };
}

/**
 * Build a complete report from run data.
 */
export function buildReport(
  cases: CaseResult[],
  config: OnlineEvalReport['config'],
  corpusInfo: OnlineEvalReport['corpus'],
  artifactDir: string,
  gitCommit?: string,
): OnlineEvalReport {
  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    run_metadata: {
      airengine_version: '0.2.0',
      node_version: process.version,
      platform: process.platform,
      ...(gitCommit ? { git_commit: gitCommit } : {}),
    },
    config,
    corpus: corpusInfo,
    cases,
    metrics: computeMetrics(cases),
    artifact_dir: artifactDir,
  };
}

// ---- CLI Helpers ----

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function getGitCommit(): string | undefined {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

interface CliArgs {
  corpus: string;
  limit: number | null;
  repairMode: 'deterministic' | 'claude' | 'none';
  maxRepairAttempts: number;
  generatorModel: string | undefined;
  repairModel: string | undefined;
  timeoutMs: number;
  providerRetries: number;
  repairProviderRetries: number;
  output: string;
  verbose: boolean;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    corpus: 'benchmarks/online-eval-corpus.json',
    limit: null,
    repairMode: 'deterministic',
    maxRepairAttempts: 1,
    generatorModel: undefined,
    repairModel: undefined,
    timeoutMs: 30000,
    providerRetries: 2,
    repairProviderRetries: 2,
    output: 'artifacts/eval/online-eval-report.json',
    verbose: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--corpus') result.corpus = args[++i];
    else if (arg === '--limit') result.limit = parseInt(args[++i], 10);
    else if (arg === '--repair-mode') result.repairMode = args[++i] as CliArgs['repairMode'];
    else if (arg === '--max-repair-attempts') result.maxRepairAttempts = parseInt(args[++i], 10);
    else if (arg === '--generator-model') result.generatorModel = args[++i];
    else if (arg === '--repair-model') result.repairModel = args[++i];
    else if (arg === '--timeout-ms') result.timeoutMs = parseInt(args[++i], 10);
    else if (arg === '--provider-retries') result.providerRetries = parseInt(args[++i], 10);
    else if (arg === '--repair-provider-retries') result.repairProviderRetries = parseInt(args[++i], 10);
    else if (arg === '--output') result.output = args[++i];
    else if (arg === '--verbose') result.verbose = true;
    else if (arg === '--dry-run') result.dryRun = true;
  }

  return result;
}

// ---- Main ----

async function main(): Promise<void> {
  const args = parseArgs();
  const corpusPath = resolve(args.corpus);

  // Load corpus
  const { corpus, entries } = loadCorpus(corpusPath, args.limit ?? undefined);
  const limitApplied = args.limit ?? null;

  console.log(`Online Eval Harness — AirEngine v0.2.0`);
  console.log(`Corpus: ${corpus.corpus_id} (${entries.length}/${corpus.entries.length} entries)`);
  console.log(`Repair: ${args.repairMode}, max attempts: ${args.maxRepairAttempts}`);
  console.log(`Generator model: ${args.generatorModel ?? '(default)'}`);
  console.log();

  // Dry-run mode
  if (args.dryRun) {
    console.log('DRY RUN — validating corpus and config only\n');
    console.log('Entries:');
    for (const entry of entries) {
      console.log(`  ${entry.id} [${entry.complexity}/${entry.category}] — ${entry.prompt.slice(0, 60)}...`);
    }
    console.log('\nCorpus validated. No API calls made.');
    process.exit(0);
  }

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const artifactDir = dirname(resolve(args.output));
    mkdirSync(artifactDir, { recursive: true });
    const failReport: OnlineEvalReport = buildReport(
      [],
      {
        generator_model: args.generatorModel ?? 'claude-sonnet-4-20250514',
        repair_mode: args.repairMode,
        max_repair_attempts: args.maxRepairAttempts,
        timeout_ms: args.timeoutMs,
        provider_retries: args.providerRetries,
        ...(args.repairModel ? { repair_model: args.repairModel } : {}),
        ...(args.repairProviderRetries !== 2 ? { repair_provider_retries: args.repairProviderRetries } : {}),
      },
      {
        path: args.corpus,
        total_entries: corpus.entries.length,
        limit_applied: limitApplied,
        corpus_id: corpus.corpus_id,
      },
      artifactDir,
      getGitCommit(),
    );
    writeFileSync(resolve(args.output), JSON.stringify(failReport, null, 2));
    console.error('ERROR: ANTHROPIC_API_KEY not set.');
    console.error('Hint: Set ANTHROPIC_API_KEY or use --dry-run to validate corpus without API calls.');
    console.error(`Structured failure report: ${args.output}`);
    process.exit(1);
  }

  // Create generator adapter
  const adapter = createClaudeAdapter({
    apiKey,
    ...(args.generatorModel ? { model: args.generatorModel } : {}),
    maxRetries: args.providerRetries,
    timeoutMs: args.timeoutMs,
  });

  // Run each corpus entry
  const cases: CaseResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const caseStart = performance.now();
    console.log(`[${i + 1}/${entries.length}] ${entry.id}...`);

    let genResult: GeneratorResult | undefined;
    let loopResult: LoopResult | undefined;
    let caseError: Error | undefined;

    try {
      // Step 1: Generate .air
      genResult = await adapter.generate(entry.prompt);

      if (genResult.success && genResult.source) {
        // Step 2: Run loop
        const loopTmpDir = join(tmpdir(), `airengine-eval-${entry.id}-${Date.now()}`);
        mkdirSync(loopTmpDir, { recursive: true });

        loopResult = await runLoopFromSource(genResult.source, loopTmpDir, {
          repairMode: args.repairMode,
          maxRepairAttempts: args.maxRepairAttempts,
          writeArtifacts: false,
          ...(args.repairMode === 'claude' && apiKey ? {
            claudeRepairOptions: {
              apiKey,
              ...(args.repairModel ? { model: args.repairModel } : {}),
              maxRetries: args.repairProviderRetries,
              timeoutMs: args.timeoutMs,
            },
          } : {}),
        });
      }
    } catch (err) {
      caseError = err instanceof Error ? err : new Error(String(err));
    }

    const totalMs = Math.round(performance.now() - caseStart);
    const outcome = classifyOutcome(genResult, loopResult, caseError);

    const caseResult: CaseResult = {
      id: entry.id,
      prompt_hash: hashPrompt(entry.prompt),
      outcome,
      generation: {
        success: genResult?.success ?? false,
        duration_ms: genResult?.metadata?.durationMs ?? 0,
        ...(genResult?.metadata?.model ? { model: genResult.metadata.model } : {}),
        ...(genResult?.metadata?.attempts ? { attempts: genResult.metadata.attempts } : {}),
        ...(genResult?.metadata?.inputTokens ? { input_tokens: genResult.metadata.inputTokens } : {}),
        ...(genResult?.metadata?.outputTokens ? { output_tokens: genResult.metadata.outputTokens } : {}),
        ...(genResult?.error ? { error: genResult.error } : {}),
      },
      ...(loopResult ? {
        loop: {
          stages: loopResult.stages.map(s => ({
            name: s.name,
            status: s.status,
            duration_ms: s.durationMs,
          })),
          ...(loopResult.repairAttempts ? { repair_attempts: loopResult.repairAttempts.length } : {}),
          deterministic: loopResult.determinismCheck?.deterministic ?? false,
          file_count: loopResult.transpileResult
            ? Object.keys(loopResult.determinismCheck?.outputHashes ?? {}).length
            : 0,
          output_lines: loopResult.transpileResult
            ? loopResult.transpileResult.files.reduce((sum, f) => sum + f.content.split('\n').length, 0)
            : 0,
        },
      } : {}),
      total_duration_ms: totalMs,
      ...(caseError ? { error: caseError.message } : {}),
    };

    cases.push(caseResult);

    if (args.verbose) {
      console.log(`  outcome: ${outcome} (${totalMs}ms)`);
      if (loopResult) {
        for (const s of loopResult.stages) {
          console.log(`    ${s.name}: ${s.status} (${s.durationMs}ms)`);
        }
      }
    } else {
      const icon = outcome === 'success_running_app' ? 'PASS' : 'FAIL';
      console.log(`  ${icon} (${totalMs}ms)`);
    }
  }

  // Build and write report
  const artifactDir = dirname(resolve(args.output));
  mkdirSync(artifactDir, { recursive: true });

  const generatorModel = args.generatorModel ?? adapter.name.replace('claude:', '') ?? 'claude-sonnet-4-20250514';
  const report = buildReport(
    cases,
    {
      generator_model: generatorModel,
      repair_mode: args.repairMode,
      max_repair_attempts: args.maxRepairAttempts,
      timeout_ms: args.timeoutMs,
      provider_retries: args.providerRetries,
      ...(args.repairModel ? { repair_model: args.repairModel } : {}),
      ...(args.repairProviderRetries !== 2 ? { repair_provider_retries: args.repairProviderRetries } : {}),
    },
    {
      path: args.corpus,
      total_entries: corpus.entries.length,
      limit_applied: limitApplied,
      corpus_id: corpus.corpus_id,
    },
    artifactDir,
    getGitCommit(),
  );

  writeFileSync(resolve(args.output), JSON.stringify(report, null, 2));

  // Print summary
  const m = report.metrics;
  console.log();
  console.log('=== Online Eval Summary ===');
  console.log(`Cases: ${m.total_cases} total, ${m.success_count} succeeded`);
  console.log(`Prompt→AIR rate:        ${(m.prompt_to_air_success_rate * 100).toFixed(1)}%`);
  console.log(`Prompt→Running App rate: ${(m.prompt_to_running_app_success_rate * 100).toFixed(1)}%`);
  console.log(`Timing: avg=${m.timing.avg_total_ms}ms p50=${m.timing.p50_total_ms}ms p95=${m.timing.p95_total_ms}ms`);
  console.log(`Tokens: ${m.tokens.total_input} in / ${m.tokens.total_output} out`);
  console.log();
  console.log('Failure breakdown:');
  for (const [k, v] of Object.entries(m.failure_breakdown)) {
    if (v > 0 && k !== 'success_running_app') console.log(`  ${k}: ${v}`);
  }
  console.log();
  console.log(`Report: ${args.output}`);
}

// Guard: only run when executed directly, not when imported for tests
const isDirectRun = process.argv[1]?.includes('eval-online');
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
