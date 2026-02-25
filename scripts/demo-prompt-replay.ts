#!/usr/bin/env npx tsx
/**
 * A5b Prompt-to-App Replay Orchestrator
 *
 * Accepts a natural-language prompt, generates .air source via the replay
 * adapter (deterministic, fixture-backed, no LLM), then runs the full loop
 * pipeline (validate → repair → transpile → smoke → determinism).
 *
 * Usage:
 *   node --import tsx scripts/demo-prompt-replay.ts --prompt "build a todo app"
 *   node --import tsx scripts/demo-prompt-replay.ts --fixture-id todo
 *   node --import tsx scripts/demo-prompt-replay.ts --list-fixtures
 *
 * Output: artifacts/prompt-replay/prompt-replay-result.json
 * Exit:   0 = generation + loop success, 1 = any failure
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { createReplayAdapter, createNoopGeneratorAdapter, listReplayFixtures } from '../src/generator.js';
import { runLoopFromSource } from '../src/cli/loop.js';
import type { GeneratorAdapter, GeneratorResult } from '../src/generator.js';
import type { LoopResult } from '../src/cli/loop.js';

// ---- Result types (matches prompt-replay-result.schema.json) ----

interface PromptMetadata {
  text: string;
  hash: string;
  source: 'cli_arg' | 'file';
  source_path?: string;
}

interface GeneratorMetadata {
  adapter: string;
  fixture_id?: string;
  prompt_hash: string;
  duration_ms: number;
}

interface GeneratedAirSummary {
  source_hash: string;
  line_count: number;
  artifact_path?: string;
}

interface LoopStageResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
}

interface LoopResultSummary {
  success: boolean;
  stages: LoopStageResult[];
  file_count?: number;
  output_lines?: number;
  deterministic?: boolean;
  artifact_dir?: string;
}

interface Timing {
  generate_ms: number;
  loop_ms: number;
  total_ms: number;
}

interface ArtifactPaths {
  report?: string;
  generated_air?: string;
  loop_artifacts?: string;
  output_dir?: string;
}

interface PromptReplayResult {
  schema_version: '1.0';
  success: boolean;
  timestamp: string;
  prompt: PromptMetadata;
  generator: GeneratorMetadata;
  generated_air: GeneratedAirSummary | null;
  loop_result: LoopResultSummary | null;
  timing: Timing;
  artifacts: ArtifactPaths;
  error?: string;
}

// ---- Helpers ----

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function log(msg: string) {
  console.log(msg);
}

// ---- CLI arg parsing ----

function parseArgs(): { prompt?: string; fixtureId?: string; listFixtures: boolean; adapter: string } {
  const args = process.argv.slice(2);
  let prompt: string | undefined;
  let fixtureId: string | undefined;
  let listFixtures = false;
  let adapter = 'replay';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' && i + 1 < args.length) {
      prompt = args[++i];
    } else if (args[i] === '--fixture-id' && i + 1 < args.length) {
      fixtureId = args[++i];
    } else if (args[i] === '--list-fixtures') {
      listFixtures = true;
    } else if (args[i] === '--adapter' && i + 1 < args.length) {
      adapter = args[++i];
    }
  }

  return { prompt, fixtureId, listFixtures, adapter };
}

// ---- Main ----

async function main() {
  const cliArgs = parseArgs();

  // --list-fixtures: print available fixtures and exit
  if (cliArgs.listFixtures) {
    log('\n  Available replay fixtures:\n');
    for (const f of listReplayFixtures()) {
      log(`    ${f.fixtureId.padEnd(18)} ${f.prompt.padEnd(45)} ${f.file}`);
    }
    log('');
    process.exit(0);
  }

  // Validate: need --prompt or --fixture-id
  if (!cliArgs.prompt && !cliArgs.fixtureId) {
    log('\n  Error: --prompt "..." or --fixture-id <id> is required.');
    log('  Use --list-fixtures to see available fixtures.\n');
    process.exit(1);
  }

  // Resolve prompt from fixture-id if needed
  let prompt = cliArgs.prompt;
  if (!prompt && cliArgs.fixtureId) {
    const fixtures = listReplayFixtures();
    const match = fixtures.find(f => f.fixtureId === cliArgs.fixtureId);
    if (!match) {
      log(`\n  Error: Unknown fixture ID "${cliArgs.fixtureId}".`);
      log(`  Available: ${fixtures.map(f => f.fixtureId).join(', ')}\n`);
      process.exit(1);
    }
    prompt = match.prompt;
  }

  if (!prompt) {
    log('\n  Error: Could not resolve prompt.\n');
    process.exit(1);
  }

  log('\n  AirEngine Prompt-to-App Replay (A5b)\n');
  log(`  Prompt:   "${prompt}"`);
  log(`  Adapter:  ${cliArgs.adapter}`);
  if (cliArgs.fixtureId) log(`  Fixture:  ${cliArgs.fixtureId}`);

  const totalStart = performance.now();

  // Select adapter
  const adapter: GeneratorAdapter = cliArgs.adapter === 'noop'
    ? createNoopGeneratorAdapter()
    : createReplayAdapter();

  // Prepare artifact dir
  const artifactDir = 'artifacts/prompt-replay';
  mkdirSync(artifactDir, { recursive: true });

  // Step 1: Generate .air source
  log('\n  Step 1: Generate .air source...');
  const genStart = performance.now();
  const genResult: GeneratorResult = adapter.generate(prompt, {
    fixtureId: cliArgs.fixtureId,
  });
  const generateMs = Math.round(performance.now() - genStart);

  const promptMeta: PromptMetadata = {
    text: prompt,
    hash: hashString(prompt),
    source: 'cli_arg',
  };

  const generatorMeta: GeneratorMetadata = {
    adapter: genResult.metadata.adapter,
    fixture_id: genResult.metadata.fixtureId,
    prompt_hash: genResult.metadata.promptHash,
    duration_ms: genResult.metadata.durationMs,
  };

  if (!genResult.success) {
    log(`  FAIL  Generation failed: ${genResult.error}`);

    const result: PromptReplayResult = {
      schema_version: '1.0',
      success: false,
      timestamp: new Date().toISOString(),
      prompt: promptMeta,
      generator: generatorMeta,
      generated_air: null,
      loop_result: null,
      timing: {
        generate_ms: generateMs,
        loop_ms: 0,
        total_ms: Math.round(performance.now() - totalStart),
      },
      artifacts: { report: join(artifactDir, 'prompt-replay-result.json') },
      error: genResult.error,
    };

    writeFileSync(join(artifactDir, 'prompt-replay-result.json'), JSON.stringify(result, null, 2));
    log(`\n  Report: ${join(artifactDir, 'prompt-replay-result.json')}\n`);
    process.exit(1);
  }

  // Write generated .air source
  const generatedAirPath = join(artifactDir, 'generated.air');
  writeFileSync(generatedAirPath, genResult.source);
  log(`  PASS  Generated ${genResult.source.split('\n').length} lines`);
  log(`  Saved: ${generatedAirPath}`);

  const generatedAirSummary: GeneratedAirSummary = {
    source_hash: hashString(genResult.source),
    line_count: genResult.source.split('\n').length,
    artifact_path: generatedAirPath,
  };

  // Step 2: Run loop pipeline
  log('\n  Step 2: Run loop pipeline...');
  const loopStart = performance.now();
  const tmpOut = join(tmpdir(), `prompt-replay-${Date.now()}`);
  mkdirSync(tmpOut, { recursive: true });

  let loopResult: LoopResult;
  try {
    loopResult = await runLoopFromSource(genResult.source, tmpOut, {
      file: generatedAirPath,
      writeArtifacts: true,
    });
  } catch (err: any) {
    const loopMs = Math.round(performance.now() - loopStart);
    log(`  FAIL  Loop pipeline error: ${err.message}`);

    const result: PromptReplayResult = {
      schema_version: '1.0',
      success: false,
      timestamp: new Date().toISOString(),
      prompt: promptMeta,
      generator: generatorMeta,
      generated_air: generatedAirSummary,
      loop_result: null,
      timing: {
        generate_ms: generateMs,
        loop_ms: loopMs,
        total_ms: Math.round(performance.now() - totalStart),
      },
      artifacts: {
        report: join(artifactDir, 'prompt-replay-result.json'),
        generated_air: generatedAirPath,
      },
      error: `Loop pipeline error: ${err.message}`,
    };

    writeFileSync(join(artifactDir, 'prompt-replay-result.json'), JSON.stringify(result, null, 2));
    try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
    log(`\n  Report: ${join(artifactDir, 'prompt-replay-result.json')}\n`);
    process.exit(1);
  }

  const loopMs = Math.round(performance.now() - loopStart);

  // Print stage results
  log('');
  for (const stage of loopResult.stages) {
    const icon = stage.status === 'pass' ? '  PASS' : stage.status === 'fail' ? '  FAIL' : '  SKIP';
    log(`  ${icon}  ${stage.name} (${stage.durationMs}ms)`);
  }

  // Determine loop success: no stage has status 'fail'
  // repair(skip) on valid input is expected, not a failure
  const loopSuccess = !loopResult.stages.some(s => s.status === 'fail');

  const loopResultSummary: LoopResultSummary = {
    success: loopSuccess,
    stages: loopResult.stages.map(s => ({
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
    })),
    file_count: loopResult.transpileResult?.files.length,
    output_lines: loopResult.transpileResult?.stats.outputLines,
    deterministic: loopResult.determinismCheck.deterministic,
    artifact_dir: loopResult.artifactDir,
  };

  // Overall success: generation succeeded AND no failed stages
  const overallSuccess = genResult.success && loopSuccess;

  const totalMs = Math.round(performance.now() - totalStart);

  const result: PromptReplayResult = {
    schema_version: '1.0',
    success: overallSuccess,
    timestamp: new Date().toISOString(),
    prompt: promptMeta,
    generator: generatorMeta,
    generated_air: generatedAirSummary,
    loop_result: loopResultSummary,
    timing: {
      generate_ms: generateMs,
      loop_ms: loopMs,
      total_ms: totalMs,
    },
    artifacts: {
      report: join(artifactDir, 'prompt-replay-result.json'),
      generated_air: generatedAirPath,
      loop_artifacts: loopResult.artifactDir,
      output_dir: tmpOut,
    },
  };

  writeFileSync(join(artifactDir, 'prompt-replay-result.json'), JSON.stringify(result, null, 2));

  log('');
  if (loopResult.transpileResult) {
    log(`  Output:   ${loopResult.transpileResult.files.length} files, ${loopResult.transpileResult.stats.outputLines} lines`);
  }
  log(`  Deterministic: ${loopResult.determinismCheck.deterministic ? 'yes' : 'NO'}`);
  log(`  Time:     ${totalMs}ms (generate: ${generateMs}ms, loop: ${loopMs}ms)`);
  log(`  Report:   ${join(artifactDir, 'prompt-replay-result.json')}`);
  log(`\n  Verdict: ${overallSuccess ? 'PASS' : 'FAIL'}\n`);

  // Cleanup temp dir
  try { rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }

  process.exit(overallSuccess ? 0 : 1);
}

main();
