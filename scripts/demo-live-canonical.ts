/**
 * AirEngine Canonical Live Demo Pipeline (A5d)
 *
 * Single-command demo runner: prompt -> generate .air -> loop pipeline -> artifacts.
 * Supports Claude (live) and replay (fallback/CI) adapters.
 *
 * Usage:
 *   npx tsx scripts/demo-live-canonical.ts --adapter replay
 *   npx tsx scripts/demo-live-canonical.ts --adapter claude
 *   npx tsx scripts/demo-live-canonical.ts --adapter claude --repair-mode claude --max-repair-attempts 2
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { createClaudeAdapter, createReplayAdapter } from '../src/generator.js';
import type { GeneratorAdapter, GeneratorResult } from '../src/generator.js';
import { runLoopFromSource } from '../src/cli/loop.js';
import type { LoopResult, LoopStage } from '../src/cli/loop.js';

// ---- Types ----

export type DemoOutcome =
  | 'success'
  | 'generation_failed'
  | 'loop_failed'
  | 'missing_api_key'
  | 'unexpected_error';

export interface PromptMetadata {
  text: string;
  hash: string;
  char_count: number;
  source: 'canonical' | 'cli_arg' | 'file';
  source_path?: string;
}

export interface GeneratorMetadata {
  adapter: string;
  model?: string;
  attempts?: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms: number;
  fixture_id?: string;
}

export interface LoopSummary {
  stages: Array<{ name: string; status: string; duration_ms: number }>;
  repair_mode: string;
  repair_attempts?: number;
  deterministic: boolean;
  file_count: number;
  output_lines: number;
}

export interface DemoResult {
  schema_version: '1.0';
  timestamp: string;
  run_metadata: {
    airengine_version: string;
    node_version: string;
    platform: string;
    git_commit?: string;
  };
  prompt: PromptMetadata;
  generator: GeneratorMetadata;
  loop: LoopSummary | null;
  outcome: DemoOutcome;
  success: boolean;
  total_duration_ms: number;
  artifact_paths: {
    report: string;
    generated_air?: string;
    output_dir?: string;
  };
  error?: string;
}

// ---- Canonical Prompt ----

const DEFAULT_CANONICAL_PROMPT_PATH = 'benchmarks/canonical-demo-prompt.json';
const DEFAULT_REPLAY_FIXTURE_ID = 'fullstack-todo';

export interface CanonicalPromptFile {
  demo_id: string;
  schema_version: string;
  prompt: string;
  goal?: string;
  expected_capabilities?: string[];
  recommended_defaults?: Record<string, unknown>;
}

/**
 * Load the canonical prompt from the config file.
 */
export function loadCanonicalPrompt(path?: string): CanonicalPromptFile {
  const p = path ?? DEFAULT_CANONICAL_PROMPT_PATH;
  const raw = readFileSync(p, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.prompt || typeof data.prompt !== 'string') {
    throw new Error(`Canonical prompt file missing "prompt" field`);
  }
  return data as CanonicalPromptFile;
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

/**
 * Build a DemoResult from run data.
 */
export function buildDemoResult(
  prompt: PromptMetadata,
  generator: GeneratorMetadata,
  loopSummary: LoopSummary | null,
  outcome: DemoOutcome,
  totalDurationMs: number,
  artifactPaths: DemoResult['artifact_paths'],
  error?: string,
): DemoResult {
  return {
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    run_metadata: {
      airengine_version: '0.2.0',
      node_version: process.version,
      platform: process.platform,
      ...(getGitCommit() ? { git_commit: getGitCommit() } : {}),
    },
    prompt,
    generator,
    loop: loopSummary,
    outcome,
    success: outcome === 'success',
    total_duration_ms: totalDurationMs,
    artifact_paths: artifactPaths,
    ...(error ? { error } : {}),
  };
}

/**
 * Extract a LoopSummary from a LoopResult.
 */
export function extractLoopSummary(loop: LoopResult, repairMode: string): LoopSummary {
  return {
    stages: loop.stages.map(s => ({ name: s.name, status: s.status, duration_ms: s.durationMs })),
    repair_mode: repairMode,
    ...(loop.repairAttempts ? { repair_attempts: loop.repairAttempts.length } : {}),
    deterministic: loop.determinismCheck?.deterministic ?? false,
    file_count: loop.transpileResult
      ? Object.keys(loop.determinismCheck?.outputHashes ?? {}).length
      : 0,
    output_lines: loop.transpileResult
      ? loop.transpileResult.files.reduce((sum, f) => sum + f.content.split('\n').length, 0)
      : 0,
  };
}

/**
 * Determine outcome from generation and loop results.
 */
export function classifyDemoOutcome(
  genResult?: GeneratorResult,
  loopResult?: LoopResult,
  error?: Error,
): DemoOutcome {
  if (error) return 'unexpected_error';
  if (!genResult || !genResult.success) return 'generation_failed';
  if (!loopResult) return 'generation_failed';

  // Check if any stage failed (repair pass compensates validate fail)
  const stages = loopResult.stages;
  const repairPassed = stages.find(s => s.name === 'repair')?.status === 'pass';
  for (const stage of stages) {
    if (stage.status === 'fail') {
      if (stage.name === 'validate' && repairPassed) continue;
      return 'loop_failed';
    }
  }
  return 'success';
}

/**
 * Format a presenter-friendly summary.
 */
export function formatPresenterSummary(result: DemoResult): string {
  const lines: string[] = [];
  const icon = result.success ? 'SUCCESS' : 'FAILED';
  lines.push(`\n=== Canonical Demo: ${icon} ===`);
  lines.push(`Adapter: ${result.generator.adapter}${result.generator.model ? ` (${result.generator.model})` : ''}`);
  lines.push(`Prompt: "${result.prompt.text.slice(0, 80)}..."`);
  lines.push('');

  // Generation
  lines.push(`Generation: ${result.generator.duration_ms}ms`);
  if (result.generator.attempts) lines.push(`  Attempts: ${result.generator.attempts}`);
  if (result.generator.input_tokens) lines.push(`  Tokens: ${result.generator.input_tokens} in / ${result.generator.output_tokens ?? 0} out`);

  // Loop stages
  if (result.loop) {
    lines.push('');
    lines.push('Pipeline:');
    for (const s of result.loop.stages) {
      const pad = s.name.padEnd(13);
      lines.push(`  ${pad} ${s.status.toUpperCase().padEnd(4)} (${s.duration_ms}ms)`);
    }
    lines.push('');
    lines.push(`Output: ${result.loop.file_count} files, ${result.loop.output_lines} lines`);
    lines.push(`Deterministic: ${result.loop.deterministic ? 'yes' : 'no'}`);
  }

  lines.push('');
  lines.push(`Total: ${result.total_duration_ms}ms`);
  lines.push(`Report: ${result.artifact_paths.report}`);
  if (result.artifact_paths.generated_air) {
    lines.push(`Generated .air: ${result.artifact_paths.generated_air}`);
  }
  if (result.artifact_paths.output_dir) {
    lines.push(`Output dir: ${result.artifact_paths.output_dir}`);
  }
  if (result.error) {
    lines.push(`\nError: ${result.error}`);
  }
  return lines.join('\n');
}

// ---- CLI ----

export interface CliArgs {
  adapter: 'replay' | 'claude';
  prompt: string | null;
  promptFile: string | null;
  repairMode: 'deterministic' | 'claude' | 'none';
  maxRepairAttempts: number;
  generatorModel: string | undefined;
  repairModel: string | undefined;
  timeoutMs: number;
  outputDir: string | null;
  keepOutput: boolean;
  verbose: boolean;
  reportPath: string;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const result: CliArgs = {
    adapter: 'replay',
    prompt: null,
    promptFile: null,
    repairMode: 'deterministic',
    maxRepairAttempts: 1,
    generatorModel: undefined,
    repairModel: undefined,
    timeoutMs: 30000,
    outputDir: null,
    keepOutput: false,
    verbose: false,
    reportPath: 'artifacts/demo/canonical-live-demo-result.json',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--adapter') result.adapter = argv[++i] as CliArgs['adapter'];
    else if (arg === '--prompt') result.prompt = argv[++i];
    else if (arg === '--prompt-file') result.promptFile = argv[++i];
    else if (arg === '--repair-mode') result.repairMode = argv[++i] as CliArgs['repairMode'];
    else if (arg === '--max-repair-attempts') result.maxRepairAttempts = parseInt(argv[++i], 10);
    else if (arg === '--generator-model') result.generatorModel = argv[++i];
    else if (arg === '--repair-model') result.repairModel = argv[++i];
    else if (arg === '--timeout-ms') result.timeoutMs = parseInt(argv[++i], 10);
    else if (arg === '--output-dir') result.outputDir = argv[++i];
    else if (arg === '--keep-output') result.keepOutput = true;
    else if (arg === '--verbose') result.verbose = true;
    else if (arg === '--output') result.reportPath = argv[++i];
  }

  return result;
}

// ---- Main ----

async function main(): Promise<void> {
  const args = parseArgs();
  const start = performance.now();

  // Resolve prompt
  let promptText: string;
  let promptSource: PromptMetadata['source'] = 'canonical';
  let promptSourcePath: string | undefined;

  if (args.prompt) {
    promptText = args.prompt;
    promptSource = 'cli_arg';
  } else if (args.promptFile) {
    promptText = readFileSync(args.promptFile, 'utf-8').trim();
    promptSource = 'file';
    promptSourcePath = args.promptFile;
  } else {
    const canonical = loadCanonicalPrompt();
    promptText = canonical.prompt;
    promptSourcePath = DEFAULT_CANONICAL_PROMPT_PATH;
  }

  const promptMeta: PromptMetadata = {
    text: promptText,
    hash: hashPrompt(promptText),
    char_count: promptText.length,
    source: promptSource,
    ...(promptSourcePath ? { source_path: promptSourcePath } : {}),
  };

  const reportPath = resolve(args.reportPath);

  console.log('Canonical Live Demo — AirEngine v0.2.0');
  console.log(`Adapter: ${args.adapter}`);
  console.log(`Repair: ${args.repairMode}, max attempts: ${args.maxRepairAttempts}`);
  console.log(`Prompt: "${promptText.slice(0, 80)}..."`);
  console.log();

  // Check API key for Claude adapter
  if (args.adapter === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    const totalMs = Math.round(performance.now() - start);
    const result = buildDemoResult(
      promptMeta,
      { adapter: 'claude', duration_ms: 0 },
      null,
      'missing_api_key',
      totalMs,
      { report: args.reportPath },
      'ANTHROPIC_API_KEY not set. Use --adapter replay for offline fallback.',
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(result, null, 2));
    console.error('ERROR: ANTHROPIC_API_KEY not set.');
    console.error('Hint: Use --adapter replay for offline fallback.');
    console.error(`Structured failure report: ${args.reportPath}`);
    process.exit(1);
  }

  // Create adapter
  let adapter: GeneratorAdapter;
  if (args.adapter === 'claude') {
    adapter = createClaudeAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      ...(args.generatorModel ? { model: args.generatorModel } : {}),
      timeoutMs: args.timeoutMs,
    });
  } else {
    adapter = createReplayAdapter();
  }

  // Set up output directory
  const outputDir = args.outputDir
    ? resolve(args.outputDir)
    : join(tmpdir(), `airengine-demo-${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });

  const artifactDir = resolve(dirname(reportPath));
  mkdirSync(artifactDir, { recursive: true });

  let genResult: GeneratorResult | undefined;
  let loopResult: LoopResult | undefined;
  let runError: Error | undefined;

  try {
    // Step 1: Generate .air
    console.log('Step 1: Generating .air source...');
    const genContext = args.adapter === 'replay'
      ? { fixtureId: DEFAULT_REPLAY_FIXTURE_ID }
      : undefined;
    genResult = await adapter.generate(promptText, genContext);

    if (genResult.success) {
      console.log(`  Generated ${genResult.source.split('\n').length} lines (${genResult.metadata.durationMs}ms)`);
      if (args.verbose && genResult.metadata.model) {
        console.log(`  Model: ${genResult.metadata.model}, attempts: ${genResult.metadata.attempts}`);
      }

      // Write generated .air
      const airPath = join(artifactDir, 'generated.air');
      writeFileSync(airPath, genResult.source);

      // Step 2: Run loop pipeline
      console.log('\nStep 2: Running pipeline (validate -> repair -> transpile -> smoke -> determinism)...');
      loopResult = await runLoopFromSource(genResult.source, outputDir, {
        repairMode: args.repairMode,
        maxRepairAttempts: args.maxRepairAttempts,
        writeArtifacts: true,
        ...(args.repairMode === 'claude' && process.env.ANTHROPIC_API_KEY ? {
          claudeRepairOptions: {
            apiKey: process.env.ANTHROPIC_API_KEY,
            ...(args.repairModel ? { model: args.repairModel } : {}),
            timeoutMs: args.timeoutMs,
          },
        } : {}),
      });

      if (args.verbose) {
        for (const s of loopResult.stages) {
          console.log(`  ${s.name.padEnd(13)} ${s.status.toUpperCase().padEnd(4)} (${s.durationMs}ms)`);
        }
      }
    } else {
      console.log(`  Generation failed: ${genResult.error}`);
    }
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
    console.error(`  Error: ${runError.message}`);
  }

  const totalMs = Math.round(performance.now() - start);
  const outcome = classifyDemoOutcome(genResult, loopResult, runError);

  const generatorMeta: GeneratorMetadata = {
    adapter: args.adapter,
    duration_ms: genResult?.metadata?.durationMs ?? 0,
    ...(genResult?.metadata?.model ? { model: genResult.metadata.model } : {}),
    ...(genResult?.metadata?.attempts ? { attempts: genResult.metadata.attempts } : {}),
    ...(genResult?.metadata?.inputTokens ? { input_tokens: genResult.metadata.inputTokens } : {}),
    ...(genResult?.metadata?.outputTokens ? { output_tokens: genResult.metadata.outputTokens } : {}),
    ...(genResult?.metadata?.fixtureId ? { fixture_id: genResult.metadata.fixtureId } : {}),
  };

  const loopSummary = loopResult ? extractLoopSummary(loopResult, args.repairMode) : null;

  const artifactPathsResult: DemoResult['artifact_paths'] = {
    report: args.reportPath,
    ...(genResult?.success ? { generated_air: join(dirname(args.reportPath), 'generated.air') } : {}),
    ...(loopResult && outcome === 'success' ? { output_dir: outputDir } : {}),
  };

  const result = buildDemoResult(
    promptMeta,
    generatorMeta,
    loopSummary,
    outcome,
    totalMs,
    artifactPathsResult,
    runError?.message ?? (outcome !== 'success' && genResult?.error ? genResult.error : undefined),
  );

  writeFileSync(reportPath, JSON.stringify(result, null, 2));

  // Print presenter summary
  console.log(formatPresenterSummary(result));

  // Cleanup temp output if not keeping
  if (!args.keepOutput && !args.outputDir && outcome === 'success') {
    try { rmSync(outputDir, { recursive: true, force: true }); } catch {}
  }

  process.exit(outcome === 'success' ? 0 : 1);
}

// Guard: only run when executed directly
const isDirectRun = process.argv[1]?.includes('demo-live-canonical');
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
