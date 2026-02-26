/**
 * C5 Complex Eval Harness
 *
 * Runs the complex eval corpus through the AirEngine pipeline in
 * replay mode (default, offline) or Claude mode (requires API key).
 *
 * Reuses loadCorpus, classifyOutcome, computeMetrics, buildReport
 * from eval-online.ts for identical outcome/metric reporting.
 *
 * Usage:
 *   npx tsx scripts/eval-complex.ts
 *   npx tsx scripts/eval-complex.ts --mode claude --limit 2
 *   npx tsx scripts/eval-complex.ts --verbose
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import {
  loadCorpus,
  classifyOutcome,
  computeMetrics,
  buildReport,
} from './eval-online.js';
import type {
  CaseResult,
  GenerationInfo,
  OnlineEvalReport,
} from './eval-online.js';
import { createClaudeAdapter } from '../src/generator.js';
import type { GeneratorResult } from '../src/generator.js';
import { runLoopFromSource } from '../src/cli/loop.js';
import type { LoopResult } from '../src/cli/loop.js';

// ---- CLI Args ----

interface CliArgs {
  mode: 'replay' | 'claude';
  corpus: string;
  limit: number | null;
  repairMode: 'deterministic' | 'claude' | 'none';
  maxRepairAttempts: number;
  generatorModel: string | undefined;
  timeoutMs: number;
  providerRetries: number;
  output: string;
  verbose: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    mode: 'replay',
    corpus: 'benchmarks/complex-eval-corpus.json',
    limit: null,
    repairMode: 'deterministic',
    maxRepairAttempts: 1,
    generatorModel: undefined,
    timeoutMs: 30000,
    providerRetries: 2,
    output: 'artifacts/eval/complex-eval-report.json',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') result.mode = args[++i] as CliArgs['mode'];
    else if (arg === '--corpus') result.corpus = args[++i];
    else if (arg === '--limit') result.limit = parseInt(args[++i], 10);
    else if (arg === '--repair-mode') result.repairMode = args[++i] as CliArgs['repairMode'];
    else if (arg === '--max-repair-attempts') result.maxRepairAttempts = parseInt(args[++i], 10);
    else if (arg === '--generator-model') result.generatorModel = args[++i];
    else if (arg === '--timeout-ms') result.timeoutMs = parseInt(args[++i], 10);
    else if (arg === '--provider-retries') result.providerRetries = parseInt(args[++i], 10);
    else if (arg === '--output') result.output = args[++i];
    else if (arg === '--verbose') result.verbose = true;
  }

  return result;
}

// ---- Helpers ----

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

// ---- Main ----

async function main(): Promise<void> {
  const args = parseArgs();
  const corpusPath = resolve(args.corpus);

  const { corpus, entries } = loadCorpus(corpusPath, args.limit ?? undefined);
  const limitApplied = args.limit ?? null;

  console.log(`Complex Eval Harness — AirEngine v0.2.0`);
  console.log(`Corpus: ${corpus.corpus_id} (${entries.length}/${corpus.entries.length} entries)`);
  console.log(`Mode: ${args.mode}`);
  console.log(`Repair: ${args.repairMode}, max attempts: ${args.maxRepairAttempts}`);
  console.log();

  // Claude mode requires API key
  if (args.mode === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const artifactDir = dirname(resolve(args.output));
      mkdirSync(artifactDir, { recursive: true });
      const failReport = buildReport(
        [],
        {
          generator_model: args.generatorModel ?? 'claude-sonnet-4-20250514',
          repair_mode: args.repairMode,
          max_repair_attempts: args.maxRepairAttempts,
          timeout_ms: args.timeoutMs,
          provider_retries: args.providerRetries,
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
      console.error('ERROR: ANTHROPIC_API_KEY not set for Claude mode.');
      console.error(`Structured failure report: ${args.output}`);
      process.exit(1);
    }
  }

  const cases: CaseResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const caseStart = performance.now();
    console.log(`[${i + 1}/${entries.length}] ${entry.id}...`);

    let genResult: GeneratorResult | undefined;
    let loopResult: LoopResult | undefined;
    let caseError: Error | undefined;

    try {
      if (args.mode === 'replay') {
        // Replay mode: read .air fixture directly
        const replayFixture = (entry as any).replay_fixture as string | undefined;
        if (!replayFixture) {
          throw new Error(`Entry "${entry.id}" has no replay_fixture field`);
        }

        const source = readFileSync(replayFixture, 'utf-8');
        genResult = {
          success: true,
          source,
          metadata: { durationMs: 0 },
        };

        const loopTmpDir = join(tmpdir(), `airengine-complex-eval-${entry.id}-${Date.now()}`);
        mkdirSync(loopTmpDir, { recursive: true });

        loopResult = await runLoopFromSource(source, loopTmpDir, {
          repairMode: args.repairMode,
          maxRepairAttempts: args.maxRepairAttempts,
          writeArtifacts: false,
        });
      } else {
        // Claude mode: generate via LLM
        const apiKey = process.env.ANTHROPIC_API_KEY!;
        const adapter = createClaudeAdapter({
          apiKey,
          ...(args.generatorModel ? { model: args.generatorModel } : {}),
          maxRetries: args.providerRetries,
          timeoutMs: args.timeoutMs,
        });

        genResult = await adapter.generate(entry.prompt);

        if (genResult.success && genResult.source) {
          const loopTmpDir = join(tmpdir(), `airengine-complex-eval-${entry.id}-${Date.now()}`);
          mkdirSync(loopTmpDir, { recursive: true });

          loopResult = await runLoopFromSource(genResult.source, loopTmpDir, {
            repairMode: args.repairMode,
            maxRepairAttempts: args.maxRepairAttempts,
            writeArtifacts: false,
          });
        }
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

  const generatorModel = args.mode === 'replay' ? 'replay' : (args.generatorModel ?? 'claude-sonnet-4-20250514');
  const report = buildReport(
    cases,
    {
      generator_model: generatorModel,
      repair_mode: args.repairMode,
      max_repair_attempts: args.maxRepairAttempts,
      timeout_ms: args.timeoutMs,
      provider_retries: args.providerRetries,
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
  console.log('=== Complex Eval Summary ===');
  console.log(`Cases: ${m.total_cases} total, ${m.success_count} succeeded`);
  console.log(`Prompt->Running App rate: ${(m.prompt_to_running_app_success_rate * 100).toFixed(1)}%`);
  console.log(`Timing: avg=${m.timing.avg_total_ms}ms p50=${m.timing.p50_total_ms}ms p95=${m.timing.p95_total_ms}ms`);
  console.log();
  console.log('Failure breakdown:');
  for (const [k, v] of Object.entries(m.failure_breakdown)) {
    if (v > 0 && k !== 'success_running_app') console.log(`  ${k}: ${v}`);
  }
  if (m.success_count === m.total_cases) console.log('  (none)');
  console.log();
  console.log(`Report: ${args.output}`);
}

// Guard: only run when executed directly
if (process.argv[1]?.includes('eval-complex')) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
